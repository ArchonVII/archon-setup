# Security model

The wizard runs a local HTTP server with the power to write files, init git, push to GitHub, and (later) handle secrets. That requires basic local-app hardening even though it never binds beyond `127.0.0.1`.

## What we do

- **Bind to `127.0.0.1` only.** Never `0.0.0.0`.
- **Random session token.** A 32-byte hex token is generated at startup. The browser is opened to `http://127.0.0.1:<port>/?token=<token>`.
- **Token required on every RPC.** Sent as `Authorization: Bearer <token>`. Constant-time comparison in `sessionToken.mjs`.
- **POST for state-changing methods.** GET only for `registry.load` and `snapshots.manifest`.
- **Origin / Host pinning.** Requests with mismatched Host or Origin headers are rejected.
- **No CORS headers.** Same-origin only.
- **Path traversal guard.** `safeJoin(root, rel)` rejects any resolved path that escapes the chosen project root.
- **Secret values never on disk, argv, serialized plan data, RPC payloads, or logs.** The `setRepoSecrets` task (staged `disabled:true` for v0.4) pipes the value to `gh secret set NAME --repo OWNER/REPO` via the commandRunner **stdin** seam. Current `gh` reads stdin only when `--body` is not specified, so `--body -` is intentionally not used. The value is supplied through a runtime-only secret provider at execute time, never through `plan.ordered[].options`, and the manifest records only the secret **name + `wasSet`**, never the value.
- **Copilot activation is manual-only for now.** The staged `enableCopilot` task uses `gh api users/<owner>` only to classify organization vs personal targets, blocks personal accounts, and records an owner checklist for organizations. It does not call a Copilot mutation endpoint until the billing, seat, and API semantics are validated in a future activation issue.

## What we don't try to do

- Defend against a malicious user already on the same machine. The token raises the bar against drive-by browser tabs and the SSRF-style "another process scans localhost" case, but anyone with shell access can read it from process listing or our log output.
- Encrypt session-state at rest. The wizard is ephemeral.

## Threat model

| Threat                                                  | Mitigation                                  |
| ------------------------------------------------------- | ------------------------------------------- |
| Browser tab on `localhost:<port>` triggers state change | Session token + Origin/Host pinning         |
| Malicious site posts to `127.0.0.1` via DNS rebinding   | Host header pinning + token gate            |
| Path traversal via crafted target path                  | `safeJoin` + preflight target check         |
| Secret leak via crash logs                              | Logger redacts `{secret: true}` fields      |
| Secret value piped to `gh secret set`                   | Value on **stdin** with `--body` omitted, never argv; manifest stores name + `wasSet` only |
| Accidental `gh secret set NAME VALUE` argv leak in output | `redact.mjs` masks the value as a defence-in-depth backstop |
| `gh` command runs with attacker-controlled args         | Arg lists hard-coded; no string concat exec |
