import { runCommand } from "../lib/commandRunner.mjs";

// Steps archon-setup cannot automate (billing + browser-only policy); recorded
// into the manifest so the owner gets an exact follow-up checklist.
const ORG_CHECKLIST = [
  "Confirm the org has a Copilot Business/Enterprise subscription (billing is browser-only).",
  "In the org Copilot policy settings, allow this repository (Settings -> Copilot).",
  "If using the Copilot coding agent, enable it for the repo and assign seats.",
];

// Decide what archon-setup can do for a Copilot enablement target. Copilot is an
// org-billed product: a personal (User) account is blocked; an organization gets
// a manual checklist (the API cannot provision billing/seats).
export function classifyCopilotTarget({ ownerType }) {
  if (ownerType === "Organization") {
    return { status: "manual-required", checklist: ORG_CHECKLIST };
  }
  return {
    status: "blocked",
    reason:
      "Copilot enablement requires an organization with Copilot billing; a personal (User) account is not supported.",
  };
}

// Detect org vs user via the STABLE `users/{owner}` endpoint (NOT the Copilot
// Preview billing API). Unknown on failure -> treated as needs-manual.
async function detectOwnerType(owner) {
  if (!owner) return "Unknown";
  try {
    const res = await runCommand("gh", ["api", `users/${owner}`, "--jq", ".type"], { timeoutMs: 15_000 });
    return res.code === 0 ? res.stdout.trim() : "Unknown";
  } catch {
    return "Unknown";
  }
}

export function check() {
  return "needs-apply"; // remote mutation; no local idempotency marker
}

export async function apply(ctx) {
  const owner = ctx.owner || ctx.taskOptions?.owner;
  const ownerType = await detectOwnerType(owner);
  const decision =
    ownerType === "Unknown"
      ? { status: "manual-required", checklist: ORG_CHECKLIST, note: "owner type undetermined; verify org + billing manually" }
      : classifyCopilotTarget({ ownerType });

  ctx.manifest.remoteActions.push({
    type: "copilot.enable",
    owner: owner || null,
    status: decision.status,
    ...(decision.checklist ? { checklist: decision.checklist } : {}),
    ...(decision.reason ? { reason: decision.reason } : {}),
  });
  return { result: decision.status === "blocked" ? "skipped" : "applied", ...decision };
}

export function verify() {
  // Enablement completion is manual/external; nothing to read back here.
  return { ok: true };
}

export function rollbackHint(ctx) {
  const owner = ctx.owner || ctx.taskOptions?.owner;
  return `Revert Copilot policy for ${owner || "<owner>"} in the org Copilot settings (browser).`;
}
