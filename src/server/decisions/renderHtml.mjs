import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./decisionDoc.mjs";

// M2 HTML face (#158): a self-contained, offline review surface for one
// DecisionDoc. The machine JSON embedded in the page IS the document — the
// form only patches `resolution` blocks into a client-side copy. Copy JSON /
// Download always work offline; Submit renders only when the caller passes a
// live { url, nonce } pair (M5b), so a saved report never embeds the session
// token (security rule from the plan).

const HERE = dirname(fileURLToPath(import.meta.url));

// F19: faces truncate oversized evidence for readability; the embedded machine
// JSON always stays complete. The limit is a recorded project choice (keeps a
// many-item report responsive in a browser), not an upstream constant.
export const FACE_DIFF_LIMIT = 20_000;

const SCRIPT_ID = "archon-decision-doc";

// Every "<" is escaped as the JSON unicode escape u003c inside the embedded
// JSON: parse-identical per the JSON grammar, and inert inside a script
// element (no script-close breakout), so hostile diff content round-trips
// byte-equal through parse -> stringify.
function embedJson(json) {
  return json.replaceAll("<", "\\u003c");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function faceDiff(diff) {
  if (diff === null) return null;
  if (diff.length <= FACE_DIFF_LIMIT) return diff;
  return `${diff.slice(0, FACE_DIFF_LIMIT)}\n… [truncated for display — the embedded machine JSON is complete]`;
}

function itemCard(item, index) {
  const recommendedNote = item.recommended
    ? `recommended: <strong>${escapeHtml(item.recommended)}</strong> (${escapeHtml(item.recommendationReason)})`
    : `no recommendation (${escapeHtml(item.recommendationReason)})`;
  const options = item.options
    .map((option) => {
      const checked = option === item.recommended ? " checked" : "";
      return `<label><input type="radio" name="choice-${index}" value="${escapeHtml(option)}"${checked}> ${escapeHtml(option)}</label>`;
    })
    .join("\n        ");
  const diff = faceDiff(item.evidence.diff);
  return `
    <section class="item" data-item-id="${escapeHtml(item.itemId)}">
      <h2>${escapeHtml(item.itemId)}</h2>
      <p class="meta">${escapeHtml(item.operation.action)} · raw ${escapeHtml(item.raw.status)}${
        item.raw.reason ? `/${escapeHtml(item.raw.reason)}` : ""
      } · ${recommendedNote}</p>
      ${diff ? `<pre class="diff">${escapeHtml(diff)}</pre>` : ""}
      <fieldset>
        <legend>Resolution</legend>
        ${options}
        <label>Rationale <input type="text" name="rationale-${index}"></label>
        <label>Notes <input type="text" name="freeText-${index}"></label>
      </fieldset>
    </section>`;
}

export function renderDecisionHtml(doc, { submit = null } = {}) {
  const json = canonicalJson(doc);
  const cards = doc.items.map((item, index) => itemCard(item, index)).join("\n");
  const submitButton = submit
    ? `<button type="button" id="submit" data-url="${escapeHtml(submit.url)}" data-nonce="${escapeHtml(submit.nonce)}">Submit to local server</button>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Decision report — ${escapeHtml(doc.repo.name)} @ ${escapeHtml(doc.repo.baseSha.slice(0, 12))}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; line-height: 1.4; }
  .item { border: 1px solid #ccc; border-radius: 6px; padding: 1rem; margin: 1rem 0; }
  .diff { background: #f6f6f6; padding: .75rem; overflow-x: auto; white-space: pre; }
  fieldset label { display: block; margin: .25rem 0; }
  .toolbar { position: sticky; top: 0; background: #fff; padding: .5rem 0; border-bottom: 1px solid #eee; }
  .meta { color: #555; }
</style>
</head>
<body>
<h1>Decision report — ${escapeHtml(doc.repo.name)}</h1>
<p class="meta">runId ${escapeHtml(doc.runId)} · base ${escapeHtml(doc.repo.baseSha)} · generated ${escapeHtml(doc.createdAt)}</p>
<p class="meta">${escapeHtml(doc.reviewBundle.instructions)}</p>
<div class="toolbar">
  <button type="button" id="copy">Copy JSON</button>
  <button type="button" id="download">Download JSON</button>
  ${submitButton}
  <label>Decided by <input type="text" id="decidedBy" placeholder="your-handle"></label>
</div>
${cards}
<script type="application/json" id="${SCRIPT_ID}">${embedJson(json)}</script>
<script>
(function () {
  "use strict";
  var doc = JSON.parse(document.getElementById("${SCRIPT_ID}").textContent);

  function completedDoc() {
    var out = JSON.parse(JSON.stringify(doc));
    var decidedBy = document.getElementById("decidedBy").value || null;
    out.items.forEach(function (item, index) {
      var choice = document.querySelector('input[name="choice-' + index + '"]:checked');
      var rationale = document.querySelector('input[name="rationale-' + index + '"]').value || null;
      var freeText = document.querySelector('input[name="freeText-' + index + '"]').value || null;
      item.resolution = {
        choice: choice ? choice.value : null,
        rationale: rationale,
        freeText: freeText,
        decidedBy: decidedBy,
        decidedAt: choice ? new Date().toISOString() : null,
      };
    });
    return JSON.stringify(out, null, 2);
  }

  document.getElementById("copy").addEventListener("click", function () {
    navigator.clipboard.writeText(completedDoc());
  });
  document.getElementById("download").addEventListener("click", function () {
    var blob = new Blob([completedDoc()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "decision-" + doc.runId + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  var submitButton = document.getElementById("submit");
  if (submitButton) {
    submitButton.addEventListener("click", function () {
      fetch(submitButton.dataset.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-archon-nonce": submitButton.dataset.nonce },
        body: completedDoc(),
      }).then(function (res) {
        submitButton.textContent = res.ok ? "Submitted" : "Submit failed (" + res.status + ")";
      }, function () {
        submitButton.textContent = "Submit failed (network)";
      });
    });
  }
})();
</script>
</body>
</html>
`;
}

// Round-trip: pull the embedded machine JSON back out of a face. The returned
// canonicalJson is JSON.stringify(parse(embedded)) — byte-equal to the
// canonical serialization the face was rendered from.
export function extractDecisionDoc(html) {
  const match = new RegExp(
    `<script type="application/json" id="${SCRIPT_ID}">([\\s\\S]*?)</script>`,
  ).exec(html);
  if (!match) return { ok: false, reason: "no embedded decision doc" };
  let doc;
  try {
    doc = JSON.parse(match[1]);
  } catch (err) {
    return { ok: false, reason: `embedded JSON unparseable: ${err.message}` };
  }
  return { ok: true, doc, canonicalJson: canonicalJson(doc) };
}

// Reports land in archon-setup's own artifacts area, never inside the target
// repo (plan security rule). Env override keeps tests hermetic.
const ARCHON_ROOT = join(HERE, "..", "..", "..");

export async function writeDecisionReport(doc, { outDir = null } = {}) {
  const dir =
    outDir ?? process.env.ARCHON_DECISION_REPORT_DIR ?? join(ARCHON_ROOT, ".html-artifacts", "decision-reports");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `decision-${doc.repo.name}-${doc.runId}.html`);
  await writeFile(path, renderDecisionHtml(doc), "utf8");
  return path;
}
