import { runCommand } from "../lib/commandRunner.mjs";

// Build the `gh secret set` invocation. The value rides STDIN (`--body -`),
// NEVER argv — so it cannot leak via process listings, logs, shell history, or
// the serialized plan. This is the single security-critical seam of lane F.
export function buildSecretSetCommand({ name, value, owner, repo }) {
  return {
    cmd: "gh",
    args: ["secret", "set", name, "--repo", `${owner}/${repo}`, "--body", "-"],
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

export async function apply(ctx) {
  const name = ctx.taskOptions?.secretName;
  // F1: the value is supplied at execute time (deferred stdin), never embedded
  // in the serialized plan/RPC payload.
  const value = ctx.taskOptions?.secretValue;
  if (!name || value == null || value === "") {
    ctx.manifest.remoteActions.push({
      type: "secret.set",
      name: name || null,
      wasSet: false,
      result: "skipped",
      reason: "no secret name/value provided",
    });
    return { result: "skipped", reason: "no secret name/value provided" };
  }

  const { cmd, args, stdin } = buildSecretSetCommand({ name, value, owner: ctx.owner, repo: ctx.repo });
  const res = await runCommand(cmd, args, { stdin, timeoutMs: 15_000 });
  if (res.code !== 0) {
    // res.stderr is gh's own message and does not echo the piped value.
    throw new Error(`gh secret set ${name} failed: ${res.stderr}`);
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
