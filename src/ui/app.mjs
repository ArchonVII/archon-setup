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
  originDetected: null,
  registry: null,
  snapshots: null,
  targetMode: "new-repo",
  context: { targetPath: "", owner: "", repo: "", visibility: "private" },
  selection: new Set(),
  options: {},
  plan: null,
  audit: null,
  existingRepoConfirmed: false,
  executionEvents: [],
  executionResult: null,
  globalUpdates: [],
  globalUpdateResults: null,
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

function statusPill(status) {
  const cls =
    ["present", "applied"].includes(status) ? "pill pill-green"
      : ["missing", "drifted", "skipped"].includes(status) ? "pill pill-yellow"
        : ["failed", "error", "blocked", "verify-failed"].includes(status) ? "pill pill-red"
          : "pill bg-slate-100 text-slate-700";
  return h("span", { class: cls }, status);
}

function selectedTargetLabel(plan = state.plan) {
  const target = plan?.context?.githubRepoTarget;
  if (target?.status === "known") return `${target.owner}/${target.repo} (${target.source})`;
  if (target?.status === "will-create") return `${plan?.context?.owner || "owner"}/${plan?.context?.repo || "repo"} (will create)`;
  return "local files only";
}

function shellQuote(value) {
  return `"${String(value || "").replaceAll('"', '\\"')}"`;
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
  card.append(h("p", { class: "mt-1 text-sm text-slate-600" }, "Choose whether the wizard should scaffold a new repo folder or audit/onboard an existing repo."));

  const isExisting = state.targetMode === "existing-repo";
  function modeButton(mode, label, detail) {
    const active = state.targetMode === mode;
    return h("button", {
      class: active
        ? "min-w-0 flex-1 rounded border border-slate-900 bg-slate-900 px-4 py-3 text-left text-white"
        : "min-w-0 flex-1 rounded border border-slate-300 bg-white px-4 py-3 text-left hover:bg-slate-50",
      type: "button",
      onClick: () => {
        state.targetMode = mode;
        state.plan = null;
        state.audit = null;
        state.existingRepoConfirmed = false;
        state.executionEvents = [];
        state.executionResult = null;
        if (mode === "existing-repo") state.selection.delete("remote.github");
        render();
      },
    },
      h("div", { class: "font-medium" }, label),
      h("div", { class: active ? "mt-1 text-xs text-slate-200" : "mt-1 text-xs text-slate-500" }, detail)
    );
  }

  const targetIn = h("input", {
    class: "min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm",
    type: "text",
    placeholder: isExisting ? "C:\\github\\existing-repo" : "C:\\github\\my-new-repo",
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
    placeholder: isExisting ? "GitHub owner override (optional)" : "GitHub owner (user or org)",
    value: state.context.owner,
  });
  ownerIn.addEventListener("input", (e) => (state.context.owner = e.target.value));

  const repoIn = h("input", {
    class: "mt-1 w-full rounded border border-slate-300 px-3 py-2",
    type: "text",
    placeholder: isExisting ? "Repo override (optional)" : "Repo name",
    value: state.context.repo,
  });
  repoIn.addEventListener("input", (e) => (state.context.repo = e.target.value));

  const visSel = h("select", { class: "mt-1 rounded border border-slate-300 px-3 py-2" },
    h("option", { value: "private", selected: state.context.visibility === "private" }, "Private"),
    h("option", { value: "public", selected: state.context.visibility === "public" }, "Public")
  );
  visSel.addEventListener("change", (e) => (state.context.visibility = e.target.value));

  card.append(
    h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row" },
      modeButton("new-repo", "New repo", "Create a fresh local repo and optionally create GitHub remote."),
      modeButton("existing-repo", "Existing repo", "Audit a populated git repo, then apply selected onboarding steps.")
    ),
    h("label", { class: "mt-4 block text-sm font-medium" }, "Target folder"),
    h("div", { class: "mt-2 flex gap-2" }, targetIn, browseBtn),
    h("label", { class: "mt-4 block text-sm font-medium" }, isExisting ? "GitHub owner override" : "GitHub owner"),
    ownerIn,
    h("label", { class: "mt-4 block text-sm font-medium" }, isExisting ? "Repo override" : "Repo name"),
    repoIn
  );
  if (isExisting) {
    card.append(
      h("p", { class: "mt-2 text-xs text-slate-500" }, "Leave owner/repo blank to use the target's GitHub origin. Existing-repo mode disables repo creation but can still target workflows, labels, and branch protection.")
    );
  } else {
    card.append(
      h("label", { class: "mt-4 block text-sm font-medium" }, "Visibility"),
      visSel
    );
  }

  const btn = h("button", {
    class: "mt-6 rounded bg-slate-900 text-white px-4 py-2 hover:bg-slate-700",
    onClick: async () => {
      const pre = await rpc("preflight.run", { target: state.context.targetPath, targetMode: state.targetMode });
      state.preflight = pre;
      state.capabilities = pre.capabilities;
      state.originDetected = pre.originDetected || null;
      const target = pre.checks.find((c) => c.id === "target");
      if (target && target.status === "red") {
        alert(target.detail);
        return;
      }
      if (state.targetMode === "existing-repo" && state.originDetected && !state.context.repo) {
        state.context.owner = state.originDetected.owner;
        state.context.repo = state.originDetected.repo;
      }
      state.selection = new Set();
      state.plan = null;
      state.audit = null;
      state.existingRepoConfirmed = false;
      state.executionEvents = [];
      state.executionResult = null;
      state.screen = "features";
      // pre-select defaults
      for (const f of state.registry.features) {
        if (f.default && !f.disabled) state.selection.add(f.id);
      }
      if (state.targetMode === "existing-repo") state.selection.delete("remote.github");
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
  if (state.targetMode === "existing-repo") {
    card.append(
      h("div", { class: "mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" },
        h("div", { class: "font-medium" }, "Existing repo audit mode"),
        h("div", { class: "mt-1" }, `Target: ${state.context.targetPath || "not set"}`),
        h("div", { class: "mt-1" }, `GitHub target: ${state.originDetected ? `${state.originDetected.owner}/${state.originDetected.repo}` : "owner/repo override required for remote settings"}`),
        h("div", { class: "mt-1" }, "Create GitHub repo is disabled; workflow, label, and protection steps target the selected existing repo.")
      )
    );
  }

  const groups = state.registry.groups
    .filter((g) => !g.disabled)
    .sort((a, b) => a.order - b.order);

  function dependenciesSatisfied(feature) {
    if (state.targetMode === "existing-repo" && feature.id === "remote.github") return false;
    for (const dep of feature.requires || []) {
      const isFeatureId = dep.includes(".");
      if (isFeatureId && !state.selection.has(dep)) return false;
    }
    for (const cap of feature.capabilitiesNeeded || []) {
      if (!state.capabilities?.[cap]) return false;
    }
    return true;
  }

  function disabledReason(feature) {
    if (state.targetMode === "existing-repo" && feature.id === "remote.github") {
      return "Disabled in Existing repo mode.";
    }
    const missingRequires = (feature.requires || []).filter((dep) => dep.includes(".") && !state.selection.has(dep));
    if (missingRequires.length) return "Requires: " + missingRequires.join(", ");
    const missingCaps = (feature.capabilitiesNeeded || []).filter((cap) => !state.capabilities?.[cap]);
    if (missingCaps.length) return "Missing capability: " + missingCaps.join(", ");
    return "";
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
          !enabled
            ? h("div", { class: "text-xs text-rose-600" }, disabledReason(f))
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
          targetMode: state.targetMode,
          capabilities: state.capabilities,
          account: state.capabilities?.account,
          originDetected: state.originDetected,
          sourceSnapshots: state.snapshots?.snapshots || {},
        },
      });
      state.plan = plan;
      state.audit = state.targetMode === "existing-repo" ? await rpc("plan.audit", { plan }) : null;
      state.existingRepoConfirmed = false;
      state.executionEvents = [];
      state.executionResult = null;
      state.screen = "review";
      render();
    },
  }, "Review plan →");
  card.append(btn);
  return card;
}

function renderAuditResults(audit) {
  if (!audit) return null;
  const wrap = h("div", { class: "mt-5 rounded border border-slate-200 bg-slate-50 p-4" });
  wrap.append(
    h("div", { class: "flex flex-wrap items-center gap-3 text-sm" },
      h("span", { class: "font-medium" }, "Audit results"),
      statusPill("present"), h("span", { class: "text-slate-600 -ml-2" }, String(audit.summary.present)),
      statusPill("missing"), h("span", { class: "text-slate-600 -ml-2" }, String(audit.summary.missing)),
      statusPill("drifted"), h("span", { class: "text-slate-600 -ml-2" }, String(audit.summary.drifted))
    )
  );
  const table = h("div", { class: "mt-3 max-h-80 overflow-auto rounded border border-slate-200 bg-white" },
    h("table", { class: "min-w-full text-left text-xs" },
      h("thead", { class: "sticky top-0 bg-white text-slate-500" },
        h("tr", {},
          h("th", { class: "py-2 pl-3 pr-3 font-medium" }, "Status"),
          h("th", { class: "py-2 pr-3 font-medium" }, "Path"),
          h("th", { class: "py-2 pr-3 font-medium" }, "Feature"),
          h("th", { class: "py-2 pr-3 font-medium" }, "Detail")
        )
      ),
      h("tbody", {},
        ...audit.items.map((item) => h("tr", { class: "border-t border-slate-100" },
          h("td", { class: "py-1.5 pl-3 pr-3" }, statusPill(item.status)),
          h("td", { class: "py-1.5 pr-3 font-mono text-slate-800" }, item.path),
          h("td", { class: "py-1.5 pr-3 text-slate-600" }, item.feature),
          h("td", { class: "py-1.5 pr-3 text-slate-600" }, item.detail || "")
        ))
      )
    )
  );
  wrap.append(table);
  return wrap;
}

function renderExistingRepoHandoff(plan, audit) {
  if (state.targetMode !== "existing-repo") return null;
  const wrap = h("div", { class: "mt-5 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950" });
  wrap.append(
    h("div", { class: "font-medium" }, "Existing repo handoff"),
    h("p", { class: "mt-1" }, `Selected target: ${selectedTargetLabel(plan)}.`)
  );

  const agentItems = (audit?.items || []).filter((item) => ["AGENTS.md", "CLAUDE.md"].includes(item.path));
  if (
    agentItems.some((item) => item.status !== "present")
    || plan.selectedFeatureIds.includes("foundation.agents")
    || plan.selectedFeatureIds.includes("foundation.claude-md")
  ) {
    wrap.append(
      h("p", { class: "mt-3" }, "For AGENTS/CLAUDE reconcile, preserve repo-specific facts and run the focused headless command if you want that slice alone:"),
      h("code", { class: "mt-2 block overflow-x-auto rounded bg-white px-2 py-1 text-xs text-blue-900" },
        `npm run onboard -- ${shellQuote(plan.context.targetPath)} --features foundation.agents,foundation.claude-md`
      )
    );
  }

  if (plan.postChecks?.some((check) => check.type === "branchProtection.tightenRequiredChecks")) {
    wrap.append(
      h("p", { class: "mt-3" }, "After the first repo-required-gate run, tighten the named required check:"),
      h("code", { class: "mt-2 block overflow-x-auto rounded bg-white px-2 py-1 text-xs text-blue-900" },
        `node bin/archon-setup.mjs tighten-required-gate --target ${shellQuote(plan.context.targetPath)}`
      )
    );
  }

  return wrap;
}

function executionOutcome(result) {
  if (!result?.ok) return "failed";
  if (["already-done", "skipped"].includes(result.status)) return "skipped";
  if (result.status === "applied") return "applied";
  return result.status || "applied";
}

function renderExecutionResults(result) {
  const wrap = h("div", { class: "mt-5 rounded border border-slate-200 bg-slate-50 p-4" });
  if (!result?.results?.length) {
    wrap.append(h("p", { class: "text-sm text-slate-500" }, "No task results yet."));
    return wrap;
  }

  const rows = result.results.map((entry) => ({ ...entry, outcome: executionOutcome(entry) }));
  const applied = rows.filter((row) => row.outcome === "applied").length;
  const skipped = rows.filter((row) => row.outcome === "skipped").length;
  const failed = rows.filter((row) => row.outcome === "failed").length;

  wrap.append(
    h("div", { class: "flex flex-wrap items-center gap-3 text-sm" },
      h("span", { class: "font-medium" }, "Execution results"),
      statusPill("applied"), h("span", { class: "text-slate-600 -ml-2" }, String(applied)),
      statusPill("skipped"), h("span", { class: "text-slate-600 -ml-2" }, String(skipped)),
      statusPill("failed"), h("span", { class: "text-slate-600 -ml-2" }, String(failed))
    )
  );
  wrap.append(
    h("div", { class: "mt-3 overflow-x-auto rounded border border-slate-200 bg-white" },
      h("table", { class: "min-w-full text-left text-xs" },
        h("thead", { class: "text-slate-500" },
          h("tr", {},
            h("th", { class: "py-2 pl-3 pr-3 font-medium" }, "Status"),
            h("th", { class: "py-2 pr-3 font-medium" }, "Task"),
            h("th", { class: "py-2 pr-3 font-medium" }, "Feature"),
            h("th", { class: "py-2 pr-3 font-medium" }, "Detail")
          )
        ),
        h("tbody", {},
          ...rows.map((entry) => h("tr", { class: "border-t border-slate-100" },
            h("td", { class: "py-1.5 pl-3 pr-3" }, statusPill(entry.outcome)),
            h("td", { class: "py-1.5 pr-3 font-mono text-slate-800" }, entry.unit?.taskId || "?"),
            h("td", { class: "py-1.5 pr-3 text-slate-600" }, entry.unit?.featureId || ""),
            h("td", { class: "py-1.5 pr-3 text-slate-600" }, entry.error || entry.status || "")
          ))
        )
      )
    )
  );
  return wrap;
}

function renderReview() {
  const card = h("section", { class: "card p-6" });
  card.append(h("h2", { class: "text-xl font-semibold" }, "Review"));
  card.append(h("p", { class: "text-sm text-slate-600 mt-1" }, "Exactly what will happen on Execute."));
  card.append(
    h("div", { class: "mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm" },
      h("div", { class: "font-medium text-slate-800" }, state.targetMode === "existing-repo" ? "Existing repo target" : "New repo target"),
      h("div", { class: "mt-1 text-slate-600" }, state.plan.context.targetPath || "No target path"),
      h("div", { class: "mt-1 text-slate-600" }, `GitHub target: ${selectedTargetLabel(state.plan)}`)
    )
  );

  const auditResults = renderAuditResults(state.audit);
  if (auditResults) card.append(auditResults);

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

  const handoff = renderExistingRepoHandoff(state.plan, state.audit);
  if (handoff) card.append(handoff);

  // Warnings block selection issues that must be fixed before Execute
  // (e.g. missing/duplicate language-CI choice per issue #17 / F1).
  const blockingWarnings = (state.plan.warnings || []).filter((w) => w.blocking);
  if (state.plan.warnings?.length) {
    card.append(h("h3", { class: "mt-4 font-medium" }, "Warnings"));
    const wUl = h("ul", { class: "mt-1 text-sm space-y-0.5" });
    for (const w of state.plan.warnings) {
      wUl.append(h("li", { class: "text-rose-700" }, "⚠ " + w.feature + ": " + w.message));
    }
    card.append(wUl);
  }

  const requiresExistingConfirmation = state.targetMode === "existing-repo";
  if (requiresExistingConfirmation) {
    const confirm = h("input", {
      type: "checkbox",
      class: "mt-1 h-4 w-4 shrink-0 rounded border-slate-300",
    });
    confirm.checked = state.existingRepoConfirmed;
    confirm.addEventListener("change", (event) => {
      state.existingRepoConfirmed = event.target.checked;
      render();
    });
    card.append(
      h("label", { class: "mt-5 flex items-start gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" },
        confirm,
        h("span", {},
          `I confirm ${state.plan.context.targetPath} is the existing repo I want to onboard, and write-capable steps may update selected files and GitHub settings for ${selectedTargetLabel(state.plan)}.`
        )
      )
    );
  }

  const canExecute = blockingWarnings.length === 0 && (!requiresExistingConfirmation || state.existingRepoConfirmed);
  const row = h("div", { class: "mt-6 flex gap-2" });
  row.append(
    h("button", {
      class: "rounded border border-slate-300 px-4 py-2 hover:bg-slate-100",
      onClick: () => { state.screen = "features"; render(); },
    }, "← Back"),
    h("button", {
      class: !canExecute
        ? "rounded bg-slate-300 text-slate-500 px-4 py-2 cursor-not-allowed"
        : "rounded bg-emerald-700 text-white px-4 py-2 hover:bg-emerald-800",
      disabled: !canExecute,
      onClick: !canExecute
        ? () => alert(
            blockingWarnings.length
              ? "Fix selection warnings before executing: " + blockingWarnings.map((w) => w.message).join("; ")
              : "Confirm the existing repo target before executing write-capable steps."
          )
        : () => { state.screen = "execute"; render(); },
    }, "Execute →")
  );
  card.append(row);
  return card;
}

function renderExecute() {
  const card = h("section", { class: "card p-6" });
  card.append(h("h2", { class: "text-xl font-semibold" }, "Executing"));
  card.append(h("p", { class: "mt-1 text-sm text-slate-600" }, `Target: ${state.plan.context.targetPath} · GitHub: ${selectedTargetLabel(state.plan)}`));
  const log = h("pre", {
    class: "mt-4 bg-slate-900 text-emerald-300 text-xs p-4 rounded h-96 overflow-auto font-mono whitespace-pre-wrap",
  }, "Starting…\n");
  card.append(log);
  const resultsHost = h("div", {});
  card.append(resultsHost);

  (async () => {
    try {
      state.executionEvents = [];
      state.executionResult = null;
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
            state.executionResult = ev;
            log.textContent += "\n✓ done\n" + JSON.stringify(ev, null, 2);
            resultsHost.innerHTML = "";
            resultsHost.append(renderExecutionResults(ev));
            const handoff = renderExistingRepoHandoff(state.plan, state.audit);
            if (handoff) resultsHost.append(handoff);
          } else if (evType === "error") {
            state.executionResult = { ok: false, results: [] };
            log.textContent += "\n✗ error\n" + JSON.stringify(ev, null, 2);
            resultsHost.innerHTML = "";
            resultsHost.append(
              h("div", { class: "mt-5 rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" },
                h("span", { class: "font-medium" }, "Execution failed"),
                h("div", { class: "mt-1" }, ev.error || "Unknown error")
              )
            );
          } else {
            state.executionEvents.push(ev);
            log.textContent += `[${ev.kind}] ${ev.taskId}${ev.result ? " (" + ev.result + ")" : ""}\n`;
          }
          log.scrollTop = log.scrollHeight;
        }
      }
    } catch (err) {
      log.textContent += "\n✗ stream error: " + err.message + "\n";
      resultsHost.innerHTML = "";
      resultsHost.append(
        h("div", { class: "mt-5 rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" },
          h("span", { class: "font-medium" }, "Execution failed"),
          h("div", { class: "mt-1" }, err.message)
        )
      );
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

function renderGlobalUpdateResults(run) {
  if (!run) return null;
  const wrap = h("div", { class: "mt-5 rounded border border-slate-200 bg-slate-50 p-4" });
  wrap.append(
    h("div", { class: "flex flex-wrap items-center gap-3 text-sm" },
      h("span", { class: "font-medium" }, run.dryRun ? "Dry-run results" : "Distribution results"),
      h("span", { class: "text-slate-600" }, `${run.updated} applied · ${run.wouldApply} would apply · ${run.unchanged} unchanged · ${run.skipped} skipped · ${run.failed} failed`)
    )
  );
  const table = h("div", { class: "mt-3 overflow-x-auto" },
    h("table", { class: "min-w-full text-left text-xs" },
      h("thead", { class: "text-slate-500" },
        h("tr", {},
          h("th", { class: "py-1 pr-3 font-medium" }, "Repo"),
          h("th", { class: "py-1 pr-3 font-medium" }, "Status"),
          h("th", { class: "py-1 pr-3 font-medium" }, "Reason"),
          h("th", { class: "py-1 pr-3 font-medium" }, "Branch")
        )
      ),
      h("tbody", {},
        ...run.results.map((entry) => h("tr", { class: "border-t border-slate-200" },
          h("td", { class: "py-1 pr-3 font-medium text-slate-800" }, entry.repo || "?"),
          h("td", { class: "py-1 pr-3 text-slate-700" }, entry.status),
          h("td", { class: "py-1 pr-3 text-slate-600" }, entry.reason || ""),
          h("td", { class: "py-1 pr-3 font-mono text-slate-500" }, entry.branch || "")
        ))
      )
    )
  );
  wrap.append(table);
  return wrap;
}

function renderGlobalUpdates(updates, reload) {
  const wrap = h("div", { class: "mt-6 border-t border-slate-200 pt-5" });
  wrap.append(
    h("h3", { class: "font-medium" }, "Global Update Records"),
    h("p", { class: "mt-1 text-sm text-slate-600" },
      "Recorded shared agent/workflow fixes. Distribution requires the exact confirmation phrase and reports every repo result."
    )
  );

  if (!updates.length) {
    wrap.append(h("p", { class: "mt-2 text-sm text-slate-500" }, "No global update records."));
    return wrap;
  }

  for (const update of updates) {
    const dryRunBtn = h("button", {
      class: "rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100",
      onClick: () => distribute(update, true),
    }, "Dry run");
    const applyBtn = h("button", {
      class: "rounded bg-emerald-700 text-white px-3 py-1.5 text-sm hover:bg-emerald-800",
      onClick: () => distribute(update, false),
    }, "Distribute Fix to Ecosystem");

    const box = h("div", { class: "mt-3 rounded border border-slate-200 p-4" },
      h("div", { class: "flex flex-wrap items-start justify-between gap-3" },
        h("div", {},
          h("div", { class: "flex flex-wrap items-center gap-2" },
            h("span", { class: "font-medium" }, update.title),
            h("span", { class: "pill pill-green" }, update.status),
            h("span", { class: "text-xs text-slate-500" }, update.date)
          ),
          h("p", { class: "mt-1 text-sm text-slate-600" }, update.summary),
          h("p", { class: "mt-2 text-xs text-amber-800" }, update.agentInstruction),
          h("code", { class: "mt-2 inline-block rounded bg-slate-100 px-2 py-1 text-xs text-slate-700" }, update.confirmationPhrase)
        ),
        h("div", { class: "flex shrink-0 gap-2" }, dryRunBtn, applyBtn)
      )
    );
    wrap.append(box);
  }

  const results = renderGlobalUpdateResults(state.globalUpdateResults);
  if (results) wrap.append(results);
  return wrap;

  async function distribute(update, dryRun) {
    const typed = prompt(`Type the exact confirmation phrase to ${dryRun ? "dry-run" : "apply"} this global update:\n\n${update.confirmationPhrase}`);
    if (typed == null) return;
    dryRunBtnDisabled(true);
    try {
      state.globalUpdateResults = await rpc("globalUpdates.distribute", {
        updateId: update.id,
        confirmation: typed,
        dryRun,
      });
      if (!state.globalUpdateResults.ok) {
        showToast(state.globalUpdateResults.status === "confirmation-required"
          ? "Confirmation phrase did not match. Nothing was changed."
          : "Distribution completed with errors. Review the result log.");
      }
      reload();
    } catch (err) {
      showToast(`Distribution failed: ${err.message}`);
    } finally {
      dryRunBtnDisabled(false);
    }
  }

  function dryRunBtnDisabled(disabled) {
    for (const button of wrap.querySelectorAll("button")) button.disabled = disabled;
  }
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
        h("p", { class: "text-sm text-slate-600 mt-1" }, "Snapshot plus controlled global update distribution.")
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
      const [snap, updates] = await Promise.all([
        rpcGet("ecosystem.snapshot"),
        rpcGet("globalUpdates.list"),
      ]);
      state.globalUpdates = updates.updates || [];
      body.innerHTML = "";
      body.append(renderSnapshot(snap));
      body.append(renderGlobalUpdates(state.globalUpdates, () => {
        body.innerHTML = "";
        body.append(renderSnapshot(snap));
        body.append(renderGlobalUpdates(state.globalUpdates, () => load()));
      }));
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
