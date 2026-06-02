import { runCommand } from "../lib/commandRunner.mjs";

// Build the `gh secret set` invocation. Current gh semantics read stdin only
// when `--body` is omitted; `--body -` would set the literal string "-".
// The value rides stdin, NEVER argv, so it cannot leak via process listings,
// shell history, or the serialized plan.
export function buildSecretSetCommand({ name, value, owner, repo }) {
  return {
    cmd: "gh",
    args: ["secret", "set", name, "--repo", `${owner}/${repo}`],
    stdin: value,
  };
}

// The manifest record for a secret set: NAME + wasSet only. The value is never
// recorded anywhere — only stdin ever carries it.
export function secretRemoteAction(name) {
  return { type: "secret.set", name, wasSet: true, result: "ok" };
}

export function check() {
  // Remote mutation: no local idempotency marker, so always attempt when planned.
  return "needs-apply";
}

async function resolveSecretValue(ctx, name) {
  if (!name) return null;
  if (typeof ctx.secretProvider === "function") {
    return ctx.secretProvider({ name, owner: ctx.owner, repo: ctx.repo, featureId: ctx.featureId });
  }
  return null;
}

export async function apply(ctx) {
  const name = ctx.taskOptions?.secretName;
  const value = await resolveSecretValue(ctx, name);
  if (!name || value == null || value === "") {
    const reason = name ? "no runtime secret value provided" : "no secret name provided";
    ctx.manifest.remoteActions.push({
      type: "secret.set",
      name: name || null,
      wasSet: false,
      result: "skipped",
      reason,
    });
    return { status: "skipped", reason };
  }

  const secretText = typeof value === "string" ? value : String(value);
  const { cmd, args, stdin } = buildSecretSetCommand({ name, value: secretText, owner: ctx.owner, repo: ctx.repo });
  const res = await runCommand(cmd, args, { stdin, timeoutMs: 15_000 });
  if (res.code !== 0) {
    throw new Error(`gh secret set ${name} failed with exit code ${res.code}`);
  }
  ctx.manifest.remoteActions.push(secretRemoteAction(name));
  return { result: "applied" };
}

export function verify() {
  // Secrets are write-only on GitHub's side; reading one back is impossible (by
  // design), so a non-error apply is the success signal.
  return { ok: true };
}

export function rollbackHint(ctx) {
  const name = ctx.taskOptions?.secretName;
  return `Remove the secret with: gh secret delete ${name || "<NAME>"} --repo ${ctx.owner}/${ctx.repo}`;
}
