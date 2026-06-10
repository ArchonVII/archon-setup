import { runCommand } from "../lib/commandRunner.mjs";
import { canonicalJson, validateDecisionDoc } from "./decisionDoc.mjs";

// M2 Save-as-Issue / resume / supersession (#158). The issue body is
// TRANSPORT, not truth: the canonical JSON rides in a fenced block with a
// dedicated language tag, and resume re-parses + schema-validates it before
// anything downstream may act (F18 — a manually edited, malformed issue can
// never execute). gh runs through the injectable runner so tests stay
// hermetic (commandRunner already honors the ARCHON_GH_BIN seam).

export const DECISION_FENCE_TAG = "archon-decision-doc";
export const DECISION_ISSUE_LABEL = "archon-decision";

async function ghRunner(args, { stdin = null } = {}) {
  return runCommand("gh", args, { stdin, timeoutMs: 60_000 });
}

export function serializeDecisionIssue(doc) {
  const counts = new Map();
  for (const item of doc.items) {
    counts.set(item.operation.action, (counts.get(item.operation.action) ?? 0) + 1);
  }
  const summaryLine = [...counts.entries()].map(([action, n]) => `${n} ${action}`).join(", ");
  const itemLines = doc.items
    .map(
      (item) =>
        `| \`${item.itemId}\` | ${item.operation.action} | ${
          item.recommended ?? "—"
        } | ${item.recommendationReason} |`,
    )
    .join("\n");

  const body = [
    `Decision report for \`${doc.repo.name}\` at base \`${doc.repo.baseSha}\` (runId \`${doc.runId}\`).`,
    "",
    `Findings: ${summaryLine}.`,
    "",
    "| item | action | recommended | reason |",
    "| --- | --- | --- | --- |",
    itemLines,
    "",
    "Resolve by editing ONLY the `resolution` blocks inside the canonical JSON below",
    "(or feed this issue to `archon-setup refresh --target <path> --intake issue:#N`).",
    "",
    `\`\`\`${DECISION_FENCE_TAG}`,
    canonicalJson(doc),
    "```",
    "",
  ].join("\n");

  return {
    title: `Decision: ${doc.repo.name} ecosystem refresh ${doc.runId}`,
    body,
    labels: [DECISION_ISSUE_LABEL],
  };
}

// Exactly one canonical fence may exist; decoy fences with other tags are
// ignored, duplicates are ambiguous, malformed JSON is fatal (F18).
export function parseDecisionIssueBody(body) {
  const fences = [];
  // GitHub fence semantics: open and close fences sit at line starts. The
  // canonical JSON is a single line (stringify escapes newlines), so a legit
  // diff containing literal backticks can never terminate the fence early.
  const re = new RegExp("(?:^|\\n)```" + DECISION_FENCE_TAG + "\\r?\\n([\\s\\S]*?)\\r?\\n```(?:\\r?\\n|$)", "g");
  let match;
  while ((match = re.exec(body)) !== null) fences.push(match[1]);

  if (fences.length === 0) return { ok: false, reason: "no canonical decision-doc fence found" };
  if (fences.length > 1) return { ok: false, reason: `ambiguous: ${fences.length} canonical fences found` };

  let doc;
  try {
    doc = JSON.parse(fences[0]);
  } catch (err) {
    return { ok: false, reason: `canonical fence JSON unparseable: ${err.message}` };
  }
  const checked = validateDecisionDoc(doc);
  if (!checked.valid) {
    return {
      ok: false,
      reason: `canonical fence is schema-invalid: ${checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
    };
  }
  return { ok: true, doc };
}

// Save-as-Issue + supersession: older open decision issues for the same repo
// get a machine-greppable comment and stop being the current report.
export async function saveDecisionIssue({ doc, repoSlug, runGh = ghRunner }) {
  const { title, body, labels } = serializeDecisionIssue(doc);

  const priorRes = await runGh([
    "issue",
    "list",
    "--repo",
    repoSlug,
    "--label",
    DECISION_ISSUE_LABEL,
    "--state",
    "open",
    "--json",
    "number,title",
  ]);
  let prior = [];
  if (priorRes.code === 0 && priorRes.stdout.trim()) {
    try {
      prior = JSON.parse(priorRes.stdout).filter((issue) =>
        issue.title.startsWith(`Decision: ${doc.repo.name} `),
      );
    } catch {
      prior = []; // listing is best-effort; creation below is not
    }
  }

  const createRes = await runGh(
    ["issue", "create", "--repo", repoSlug, "--title", title, "--label", labels.join(","), "--body-file", "-"],
    { stdin: body },
  );
  if (createRes.code !== 0) {
    throw new Error(`gh issue create failed: ${createRes.stderr.trim() || `exit ${createRes.code}`}`);
  }
  const url = createRes.stdout.trim();
  const numberMatch = /\/issues\/(\d+)\s*$/.exec(url);
  const issueNumber = numberMatch ? Number(numberMatch[1]) : null;

  const superseded = [];
  for (const issue of prior) {
    const comment = await runGh(
      ["issue", "comment", String(issue.number), "--repo", repoSlug, "--body-file", "-"],
      { stdin: `superseded-by: #${issueNumber ?? "unknown"}\nstale-base: true` },
    );
    if (comment.code === 0) superseded.push(issue.number);
  }

  return { issueNumber, url, superseded };
}

// Resume from "issue:#N" (or "issue:N"). Anything that fails to parse or
// validate is a refusal, never a degraded execution (F18).
export async function resumeDecisionIssue({ ref, repoSlug, runGh = ghRunner }) {
  const match = /^issue:#?(\d+)$/.exec(ref);
  if (!match) return { ok: false, reason: `not an issue reference: ${ref}` };

  const viewRes = await runGh(["issue", "view", match[1], "--repo", repoSlug, "--json", "body"]);
  if (viewRes.code !== 0) {
    return { ok: false, reason: `gh issue view failed: ${viewRes.stderr.trim() || `exit ${viewRes.code}`}` };
  }
  let body;
  try {
    body = JSON.parse(viewRes.stdout).body;
  } catch (err) {
    return { ok: false, reason: `gh issue view returned unparseable JSON: ${err.message}` };
  }
  return parseDecisionIssueBody(body);
}
