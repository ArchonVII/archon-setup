// src/server/ecosystem/renderHtml.mjs
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dot = (ok) => `<span class="dot ${ok ? "g" : "r"}"></span>`;

export function renderHtml(snap) {
  const ports = snap.ports.map((p) =>
    `<li>${dot(p.live)} <a href="http://127.0.0.1:${p.port}">:${p.port}</a> <code>${esc(p.command)}</code> <small>${esc(p.recordedAt)}</small></li>`
  ).join("");
  const repos = snap.repos.map((r) =>
    `<li>${dot(!r.dirty)} <b>${esc(r.name)}</b> @${esc(r.branch)}${r.dirty ? " (dirty)" : ""}${r.worktrees.length > 1 ? ` · ${r.worktrees.length} worktrees` : ""}</li>`
  ).join("");
  const recent = (snap.signals.recent || []).map((s) => `<li>${esc(s)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>AI Ecosystem</title><style>
  body{font:14px/1.5 system-ui,sans-serif;background:#0b0e14;color:#d6deeb;margin:0;padding:24px;max-width:1100px}
  h1{font-size:18px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#7c8aa5;margin:24px 0 8px}
  ul{list-style:none;padding:0;margin:0}li{padding:4px 0;border-bottom:1px solid #1b2230}
  code{color:#c3e88d}a{color:#82aaff}small{color:#5c6b85}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%}.g{background:#22c55e}.r{background:#ef4444}
  .meta{color:#5c6b85}
</style></head><body>
<h1>AI Ecosystem <span class="meta">— generated ${esc(snap.generatedAt)}</span></h1>
<p class="meta">Amber: ${dot(snap.amber.online)} ${esc(snap.amber.detail)} · signals: ${snap.signals.anomalies} anomalies, ${snap.signals.noticed} noticed</p>
<h2>Ports (timestamped, not authoritative)</h2><ul>${ports || "<li>none</li>"}</ul>
<h2>Repos</h2><ul>${repos || "<li>none</li>"}</ul>
<h2>Recent signals</h2><ul>${recent || "<li>none</li>"}</ul>
</body></html>`;
}
