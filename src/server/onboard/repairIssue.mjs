import { runCommand } from "../lib/commandRunner.mjs";

const FENCE = "archon-onboarding-decision";

function validDoc(doc) {
  return doc && typeof doc === "object" && doc.schemaVersion === 1 && doc.kind === "onboarding-decision" && Array.isArray(doc.items);
}

export function serializeOnboardingDecisionIssue(doc) {
  if (!validDoc(doc)) throw new Error("expected an onboarding decision document version 1");
  const body = [
    `Decision record for onboarding \`${doc.target.name}\` at base \`${doc.baseSha}\` (run \`${doc.runId}\`).`,
    "",
    "Resolve only each item's `resolution` object in the canonical JSON below, then run `onboard repair <target> --intake issue:#N --issue N`.",
    "",
    `\`\`\`${FENCE}`,
    JSON.stringify(doc),
    "```",
    "",
  ].join("\n");
  return { title: `Decision: ${doc.target.name} onboarding repair ${doc.runId}`, body, labels: ["archon-decision"] };
}

export function parseOnboardingDecisionIssue(body) {
  const matches = [...String(body).matchAll(new RegExp("(?:^|\\n)```" + FENCE + "\\r?\\n([\\s\\S]*?)\\r?\\n```(?:\\r?\\n|$)", "g"))];
  if (matches.length !== 1) return { ok: false, reason: matches.length ? "ambiguous canonical decision documents" : "no canonical onboarding decision document found" };
  try {
    const doc = JSON.parse(matches[0][1]);
    return validDoc(doc) ? { ok: true, doc } : { ok: false, reason: "canonical onboarding decision document is invalid" };
  } catch (error) {
    return { ok: false, reason: `canonical onboarding decision JSON is unparseable: ${error.message}` };
  }
}

async function gh(args, options = {}) {
  return runCommand("gh", args, { stdin: options.stdin ?? null });
}

export async function saveOnboardingDecisionIssue({ doc, repoSlug, runGh = gh }) {
  const issue = serializeOnboardingDecisionIssue(doc);
  const result = await runGh(
    ["issue", "create", "--repo", repoSlug, "--title", issue.title, "--label", issue.labels.join(","), "--body-file", "-"],
    { stdin: issue.body },
  );
  if (result.code !== 0) throw new Error(`gh issue create failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  const url = result.stdout.trim();
  const match = /\/issues\/(\d+)\s*$/.exec(url);
  if (!match) throw new Error(`gh issue create returned no issue URL: ${url || "(empty stdout)"}`);
  return { number: Number(match[1]), url };
}

export async function resumeOnboardingDecisionIssue({ ref, repoSlug, runGh = gh }) {
  const match = /^issue:#?(\d+)$/.exec(ref);
  if (!match) return { ok: false, reason: `not an issue reference: ${ref}` };
  const result = await runGh(["issue", "view", match[1], "--repo", repoSlug, "--json", "body"]);
  if (result.code !== 0) return { ok: false, reason: `gh issue view failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}` };
  try {
    return parseOnboardingDecisionIssue(JSON.parse(result.stdout).body);
  } catch (error) {
    return { ok: false, reason: `gh issue view returned unparseable JSON: ${error.message}` };
  }
}
