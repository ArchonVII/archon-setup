// Tiny vanilla-DOM UI. v0.1 skeleton — Vite + React migration tracked as a follow-up.
// Communicates with the local server via /rpc/<method> with the session token.

const token = new URLSearchParams(location.search).get("token");
if (!token) {
  document.getElementById("app").innerHTML =
    "<h1 class='text-2xl font-bold'>Missing session token.</h1><p>Launch via <code>npx @archonvii/archon-setup</code>.</p>";
  throw new Error("no token");
}

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function rpc(method, params = {}, { stream } = {}) {
  const url = `/rpc/${method}`;
  if (stream) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });
    return res; // caller reads streaming body
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`${method} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function rpcGet(method) {
  const res = await fetch(`/rpc/${method}`, { headers });
  if (!res.ok) throw new Error(`${method} -> ${res.status}`);
  return res.json();
}

const state = {
  screen: "doctor",
  preflight: null,
  capabilities: null,
  registry: null,
  snapshots: null,
  context: { targetPath: "", owner: "", repo: "", visibility: "private" },
  selection: new Set(),
  options: {},
  plan: null,
  executionEvents: [],
};

// Land directly on the dashboard when launched with #ecosystem (the desktop launcher uses this).
if (typeof location !== "undefined" && location.hash === "#ecosystem") state.screen = "ecosystem";

const app = document.getElementById("app");
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer = null;
function showToast(message) {
  document.getElementById("toast")?.remove();
  const toast = h("div", {
    id: "toast",
    class: "fixed bottom-4 right-4 max-w-sm rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow",
  }, message);
  document.body.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 5000);
}

function pill(status) {
  const cls = status === "green" ? "pill pill-green" : status === "yellow" ? "pill pill-yellow" : "pill pill-red";
  return h("span", { class: cls }, status);
}

const WIZARD_SCREENS = ["doctor", "location", "features", "review", "execute"];

function navLink(label, screen) {
  const active = state.screen === screen || (screen === "doctor" && WIZARD_SCREENS.includes(state.screen));
  return h("button", {
    class: active
      ? "rounded bg-slate-900 text-white px-3 py-1.5 text-sm"
      : "rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100",
    onClick: () => { state.screen = screen; render(); },
  }, label);
}

function render() {
  app.innerHTML = "";
  app.append(
    h("header", { class: "mb-6 flex items-start justify-between gap-4" },
      h("div", {},
        h("h1", { class: "text-3xl font-bold" }, "archon-setup"),
        h("p", { class: "text-slate-600 mt-1" }, "Plug-and-play repo bootstrapper.")
      ),
      h("nav", { class: "flex gap-2 shrink-0" }, navLink("Wizard", "doctor"), navLink("Ecosystem", "ecosystem"))
    )
  );
  const screens = { doctor: renderDoctor, location: renderLocation, features: renderFeatures, review: renderReview, execute: renderExecute, ecosystem: renderEcosystem };
  app.append(screens[state.screen]());
}

function renderDoctor() {
  const card = h("section", { class: "card p-6" });
  card.append(h("h2", { class: "text-xl font-semibold" }, "Doctor"));
  card.append(h("p", { class: "text-slate-600 mt-1" }, "Checking your environment…"));
  const list = h("ul", { class: "mt-4 space-y-2" });
  card.append(list);

  const btnRow = h("div", { class: "mt-6 flex gap-2" });
  card.append(btnRow);

  (async () => {
    try {
      const snap = await rpcGet("snapshots.manifest");
      state.snapshots = snap;
      const reg = await rpcGet("registry.load");
      state.registry = reg;
      const pre = await rpc("preflight.run", { target: null });
      state.preflight = pre;
      state.capabilities = pre.capabilities;
      list.innerHTML = "";
      for (const c of pre.checks) {
        const row = h("li", { class: "flex items-start gap-3" },
          pill(c.status),
          h("div", {},
            h("div", { class: "font-medium" }, c.id),
            h("div", { class: "text-sm text-slate-600" }, c.detail || ""),
            c.fix ? h("div", { class: "text-sm text-blue-700" }, c.fix) : null
          )
        );
        list.append(row);
      }
      const okToProceed = pre.summary.red === 0 || true; // local-only is always possible
      btnRow.append(
        h("button", {
          class: "rounded bg-slate-900 text-white px-4 py-2 hover:bg-slate-700",
          onClick: () => {
            if (pre.capabilities?.account && !state.context.owner) {
              state.context.owner = pre.capabilities.account;
            }
            state.screen = "location";
            render();
          },
        }, "Continue →")
      );
    } catch (err) {
      list.append(h("li", { class: "text-rose-700" }, "Preflight failed: " + err.message));
    }
  })();

  return card;
}

function renderLocation() {
  const card = h("section", { class: "card p-6" });
  card.append(h("h2", { class: "text-xl font-semibold" }, "Where should this live?"));

  const targetIn = h("input", {
    class: "min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm",
    type: "text",
    placeholder: "C:\\github\\my-new-repo",
    value: state.context.targetPath,
  });
  targetIn.addEventListener("input", (e) => (state.context.targetPath = e.target.value));
  const browseBtn = h("button", {
    class: "shrink-0 rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100",
    type: "button",
    onClick: async () => {
      browseBtn.disabled = true;
      try {
        const result = await rpc("folder.pick");
        if (result.path) {
          state.context.targetPath = result.path;
          render();
          return;
        }
        if (result.cancelled) {
          targetIn.focus();
          return;
        }
        showToast(
          result.unsupported
            ? "Folder picker is unavailable here. Type the folder path instead."
            : `Folder picker failed: ${result.error || "unknown error"}. Type the folder path instead.`
        );
        targetIn.focus();
      } catch (err) {
        showToast(`Folder picker failed: ${err.message}. Type the folder path instead.`);
        targetIn.focus();
      } finally {
        browseBtn.disabled = false;
      }
    },
  }, "Browse…");

  const ownerIn = h("input", {
    class: "mt-1 w-full rounded border border-slate-300 px-3 py-2",
    type: "text",
    placeholder: "GitHub owner (user or org)",
    value: state.context.owner,
  });
  ownerIn.addEventListener("input", (e) => (state.context.owner = e.target.value));

  const repoIn = h("input", {
    class: "mt-1 w-full rounded border border-slate-300 px-3 py-2",
    type: "text",
    placeholder: "Repo name",
    value: state.context.repo,
  });
  repoIn.addEventListener("input", (e) => (state.context.repo = e.target.value));

  const visSel = h("select", { class: "mt-1 rounded border border-slate-300 px-3 py-2" },
    h("option", { value: "private", selected: state.context.visibility === "private" }, "Private"),
    h("option", { value: "public", selected: state.context.visibility === "public" }, "Public")
  );
  visSel.addEventListener("change", (e) => (state.context.visibility = e.target.value));

  card.append(
    h("label", { class: "mt-4 block text-sm font-medium" }, "Target folder"),
    h("div", { class: "mt-2 flex gap-2" }, targetIn, browseBtn),
    h("label", { class: "mt-4 block text-sm font-medium" }, "GitHub owner"),
    ownerIn,
    h("label", { class: "mt-4 block text-sm font-medium" }, "Repo name"),
    repoIn,
    h("label", { class: "mt-4 block text-sm font-medium" }, "Visibility"),
    visSel
  );

  const btn = h("button", {
    class: "mt-6 rounded bg-slate-900 text-white px-4 py-2 hover:bg-slate-700",
    onClick: async () => {
      const pre = await rpc("preflight.run", { target: state.context.targetPath });
      state.preflight = pre;
      state.capabilities = pre.capabilities;
      const target = pre.checks.find((c) => c.id === "target");
      if (target && target.status === "red") {
        alert(target.detail);
        return;
      }
      state.screen = "features";
      // pre-select defaults
      for (const f of state.registry.features) {
        if (f.default && !f.disabled) state.selection.add(f.id);
      }
      render();
    },
  }, "Continue →");
  card.append(btn);
  return card;
}

function renderFeatures() {
  const card = h("section", { class: "card p-6" });
  card.append(h("h2", { class: "text-xl font-semibold" }, "Features"));
  card.append(h("p", { class: "text-sm text-slate-600" }, "Pick what to install. Children are disabled until parents are checked."));

  const groups = state.registry.groups
    .filter((g) => !g.disabled)
    .sort((a, b) => a.order - b.order);

  function dependenciesSatisfied(feature) {
    for (const dep of feature.requires || []) {
      const isFeatureId = dep.includes(".");
      if (isFeatureId && !state.selection.has(dep)) return false;
    }
    for (const cap of feature.capabilitiesNeeded || []) {
      if (!state.capabilities?.[cap]) return false;
    }
    return true;
  }

  for (const g of groups) {
    const groupBox = h("div", { class: "mt-6" });
    groupBox.append(h("h3", { class: "font-medium text-slate-800" }, g.label));
    if (g.description) groupBox.append(h("p", { class: "text-xs text-slate-500" }, g.description));
    const ul = h("ul", { class: "mt-2 space-y-1" });
    const features = state.registry.features.filter((f) => f.group === g.id && !f.disabled);
    for (const f of features) {
      const enabled = dependenciesSatisfied(f);
      const checked = state.selection.has(f.id);
      const cb = h("input", {
        type: "checkbox",
        class: "mr-2",
      });
      cb.checked = checked && enabled;
      cb.disabled = f.locked || !enabled;
      cb.addEventListener("change", (e) => {
        if (e.target.checked) state.selection.add(f.id);
        else state.selection.delete(f.id);
        render();
      });
      if (f.locked) state.selection.add(f.id);

      const row = h("li", { class: "flex items-start" },
        cb,
        h("div", {},
          h("div", { class: enabled ? "font-medium" : "font-medium text-slate-400" }, f.label,
            f.locked ? h("span", { class: "ml-2 text-xs text-slate-500" }, "(locked)") : null
          ),
          h("div", { class: "text-xs text-slate-500" }, f.beginnerDescription || ""),
          !enabled && (f.requires || []).length
            ? h("div", { class: "text-xs text-rose-600" }, "Requires: " + (f.requires || []).join(", "))
            : null
        )
      );
      ul.append(row);
    }
    groupBox.append(ul);
    card.append(groupBox);
  }

  const btn = h("button", {
    class: "mt-6 rounded bg-slate-900 text-white px-4 py-2 hover:bg-slate-700",
    onClick: async () => {
      const plan = await rpc("plan.build", {
        selection: [...state.selection],
        options: state.options,
        context: {
          ...state.context,
          capabilities: state.capabilities,
          account: state.capabilities?.account,
          sourceSnapshots: state.snapshots?.snapshots || {},
        },
      });
      state.plan = plan;
      state.screen = "review";
      render();
    },
  }, "Review plan →");
  card.append(btn);
  return card;
}

function renderReview() {
  const card = h("section", { class: "card p-6" });
  card.append(h("h2", { class: "text-xl font-semibold" }, "Review"));
  card.append(h("p", { class: "text-sm text-slate-600 mt-1" }, "Exactly what will happen on Execute."));

  card.append(h("h3", { class: "mt-4 font-medium" }, "Files to create"));
  const filesUl = h("ul", { class: "mt-1 text-sm font-mono space-y-0.5" });
  for (const f of state.plan.files) {
    filesUl.append(h("li", { class: "text-slate-700" }, "+ " + f.path));
  }
  card.append(filesUl);

  if (state.plan.skippedFiles?.length) {
    card.append(h("h3", { class: "mt-4 font-medium" }, "Intentionally skipped"));
    const skippedUl = h("ul", { class: "mt-1 text-sm font-mono space-y-0.5" });
    for (const f of state.plan.skippedFiles) {
      skippedUl.append(h("li", { class: "text-amber-700" }, "skip " + f.path + " — " + f.reason));
    }
    card.append(skippedUl);
  }

  card.append(h("h3", { class: "mt-4 font-medium" }, "Tasks to run"));
  const tasksUl = h("ul", { class: "mt-1 text-sm font-mono space-y-0.5" });
  for (const t of state.plan.ordered) {
    tasksUl.append(h("li", { class: "text-slate-700" }, "→ " + t.taskId + "  (" + t.featureId + ")"));
  }
  card.append(tasksUl);

  if (state.plan.postChecks?.length) {
    card.append(h("h3", { class: "mt-4 font-medium" }, "Deferred post-checks"));
    const pcUl = h("ul", { class: "mt-1 text-sm space-y-0.5" });
    for (const p of state.plan.postChecks) {
      pcUl.append(h("li", { class: "text-amber-700" }, "⌛ " + p.type + " — " + p.reason));
    }
    card.append(pcUl);
  }

  // Warnings block selection issues that must be fixed before Execute
  // (e.g. missing/duplicate language-CI choice per issue #17 / F1).
  const blockingWarnings = (state.plan.warnings || []).filter(
    (w) => w.feature === "workflows.ci" || /conflicts with/.test(w.message)
  );
  if (state.plan.warnings?.length) {
    card.append(h("h3", { class: "mt-4 font-medium" }, "Warnings"));
    const wUl = h("ul", { class: "mt-1 text-sm space-y-0.5" });
    for (const w of state.plan.warnings) {
      wUl.append(h("li", { class: "text-rose-700" }, "⚠ " + w.feature + ": " + w.message));
    }
    card.append(wUl);
  }

  const row = h("div", { class: "mt-6 flex gap-2" });
  row.append(
    h("button", {
      class: "rounded border border-slate-300 px-4 py-2 hover:bg-slate-100",
      onClick: () => { state.screen = "features"; render(); },
    }, "← Back"),
    h("button", {
      class: blockingWarnings.length
        ? "rounded bg-slate-300 text-slate-500 px-4 py-2 cursor-not-allowed"
        : "rounded bg-emerald-700 text-white px-4 py-2 hover:bg-emerald-800",
      disabled: blockingWarnings.length ? "" : undefined,
      onClick: blockingWarnings.length
        ? () => alert("Fix selection warnings before executing: " + blockingWarnings.map((w) => w.message).join("; "))
        : () => { state.screen = "execute"; render(); },
    }, "Execute →")
  );
  card.append(row);
  return card;
}

function renderExecute() {
  const card = h("section", { class: "card p-6" });
  card.append(h("h2", { class: "text-xl font-semibold" }, "Executing"));
  const log = h("pre", {
    class: "mt-4 bg-slate-900 text-emerald-300 text-xs p-4 rounded h-96 overflow-auto font-mono whitespace-pre-wrap",
  }, "Starting…\n");
  card.append(log);

  (async () => {
    try {
      const res = await fetch("/rpc/plan.execute", {
        method: "POST",
        headers,
        body: JSON.stringify({ plan: state.plan }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = chunk.split("\n");
          let evType = "data";
          let dataStr = "";
          for (const l of lines) {
            if (l.startsWith("event: ")) evType = l.slice(7).trim();
            else if (l.startsWith("data: ")) dataStr += l.slice(6);
          }
          if (!dataStr) continue;
          const ev = JSON.parse(dataStr);
          if (evType === "done") {
            log.textContent += "\n✓ done\n" + JSON.stringify(ev, null, 2);
          } else if (evType === "error") {
            log.textContent += "\n✗ error\n" + JSON.stringify(ev, null, 2);
          } else {
            log.textContent += `[${ev.kind}] ${ev.taskId}${ev.result ? " (" + ev.result + ")" : ""}\n`;
          }
          log.scrollTop = log.scrollHeight;
        }
      }
    } catch (err) {
      log.textContent += "\n✗ stream error: " + err.message + "\n";
    }
  })();

  return card;
}

function dotEl(ok) {
  return h("span", { class: "inline-block h-2.5 w-2.5 rounded-full shrink-0 " + (ok ? "bg-emerald-500" : "bg-rose-500") });
}

function renderSnapshot(snap) {
  const wrap = h("div", {});

  wrap.append(
    h("div", { class: "flex flex-wrap items-center gap-3 text-sm" },
      pill("green"), h("span", { class: "text-slate-600 -ml-1" }, String(snap.summary.green)),
      pill("yellow"), h("span", { class: "text-slate-600 -ml-1" }, String(snap.summary.yellow)),
      pill("red"), h("span", { class: "text-slate-600 -ml-1" }, String(snap.summary.red)),
      h("span", { class: "text-slate-400" }, "· generated " + new Date(snap.generatedAt).toLocaleString())
    ),
    h("div", { class: "mt-3 flex items-center gap-2 text-sm" },
      dotEl(snap.amber.online),
      h("span", { class: "font-medium" }, "Amber:"),
      h("span", { class: "text-slate-600" }, snap.amber.detail || (snap.amber.online ? "online" : "offline"))
    )
  );

  wrap.append(
    h("h3", { class: "mt-5 font-medium" }, "Ports ", h("span", { class: "text-xs font-normal text-slate-500" }, "— timestamped, not authoritative"))
  );
  const portsUl = h("ul", { class: "mt-2 space-y-1" });
  if (!snap.ports.length) portsUl.append(h("li", { class: "text-sm text-slate-500" }, "none recorded"));
  for (const p of snap.ports) {
    portsUl.append(
      h("li", { class: "flex items-center gap-2 text-sm" },
        dotEl(p.live),
        h("a", { href: "http://127.0.0.1:" + p.port, target: "_blank", class: "font-mono text-blue-700 hover:underline" }, ":" + p.port),
        h("code", { class: "min-w-0 truncate text-xs text-slate-600", title: p.command }, p.command || "")
      )
    );
  }
  wrap.append(portsUl);

  wrap.append(h("h3", { class: "mt-5 font-medium" }, "Repos"));
  const reposUl = h("ul", { class: "mt-2 space-y-1" });
  if (!snap.repos.length) reposUl.append(h("li", { class: "text-sm text-slate-500" }, "none"));
  for (const r of snap.repos) {
    const wt = r.worktrees?.length ?? 0;
    reposUl.append(
      h("li", { class: "flex items-center gap-2 text-sm" },
        dotEl(!r.dirty),
        h("span", { class: "font-medium" }, r.name),
        h("span", { class: "text-slate-500" }, "@" + (r.branch || "?")),
        r.dirty ? h("span", { class: "text-xs text-amber-700" }, "dirty") : null,
        wt > 1 ? h("span", { class: "text-xs text-slate-400" }, "· " + wt + " worktrees") : null
      )
    );
  }
  wrap.append(reposUl);

  wrap.append(
    h("h3", { class: "mt-5 font-medium" }, "Recent signals ",
      h("span", { class: "text-xs font-normal text-slate-500" }, "— " + snap.signals.anomalies + " anomalies, " + snap.signals.noticed + " noticed"))
  );
  const sigUl = h("ul", { class: "mt-2 space-y-1 text-sm" });
  const recent = snap.signals.recent || [];
  if (!recent.length) sigUl.append(h("li", { class: "text-slate-500" }, "none"));
  for (const s of recent) sigUl.append(h("li", { class: "text-slate-700" }, s));
  wrap.append(sigUl);

  return wrap;
}

function renderEcosystem() {
  const card = h("section", { class: "card p-6" });
  const refreshBtn = h("button", {
    class: "shrink-0 rounded bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700",
    onClick: () => load(),
  }, "↻ Refresh");
  card.append(
    h("div", { class: "flex items-start justify-between gap-4" },
      h("div", {},
        h("h2", { class: "text-xl font-semibold" }, "AI Ecosystem"),
        h("p", { class: "text-sm text-slate-600 mt-1" }, "Read-only snapshot — ports, repos, Amber, signals.")
      ),
      refreshBtn
    )
  );

  const body = h("div", { class: "mt-4" });
  card.append(body);

  async function load() {
    refreshBtn.disabled = true;
    body.innerHTML = "";
    body.append(h("p", { class: "text-slate-500 text-sm" }, "Loading…"));
    try {
      const snap = await rpcGet("ecosystem.snapshot");
      body.innerHTML = "";
      body.append(renderSnapshot(snap));
    } catch (err) {
      body.innerHTML = "";
      body.append(h("p", { class: "text-rose-700 text-sm" }, "Snapshot failed: " + err.message));
    } finally {
      refreshBtn.disabled = false;
    }
  }
  load();
  return card;
}

render();
