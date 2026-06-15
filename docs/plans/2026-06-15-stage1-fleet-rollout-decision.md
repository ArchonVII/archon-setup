# Stage 1 Friction-Telemetry Rollout — Owner Decision Packet (2026-06-15)

**Decision owner:** repo owner (ArchonVII).
**Prepared by:** Manager session (Claude), 2026-06-15, from live GitHub + on-disk state.
**Gates:** [ArchonVII/archon-setup#238](https://github.com/ArchonVII/archon-setup/issues/238) (the rollout lane), and through it Stages 2–4 of the Agent OS roadmap epic [ArchonVII/archon-setup#229](https://github.com/ArchonVII/archon-setup/issues/229).
**Roadmap source:** `C:\GitHub\archon-setup\docs\plans\2026-06-12-os-roadmap.md`.

---

## 1. Why this is the keystone decision

Stage 1 (friction telemetry) is **built but inert**:

- Contract merged: friction ledger on repo-template main ([ArchonVII/repo-template#83](https://github.com/ArchonVII/repo-template/pull/83)). The exact header now lives at `C:\GitHub\repo-template\.claude\friction.md`.
- Collector merged: [ArchonVII/archon-setup#233](https://github.com/ArchonVII/archon-setup/issues/233) (`.claude/friction.md` → events + maintenance signals).
- New-repo wiring merged: [ArchonVII/archon-setup#234](https://github.com/ArchonVII/archon-setup/issues/234) (friction-ledger feature entry + snapshot wiring).

**But no live repo carries a ledger yet, so zero friction data is flowing.** The HARD RULE on [#238](https://github.com/ArchonVII/archon-setup/issues/238) (owner, 2026-06-12) is explicit: *Stage 1 telemetry does NOT start when #233/#234 land — it starts only when this lane's post-apply verification passes and the timestamp is recorded.* Stages 2, 3 (the visual process graph — the north-star deliverable), and 4 are all gated on having two weeks of friction data to rank what process to encode first. **Everything downstream funnels through authorizing #238.**

---

## 2. The taxonomy question (resolve this first)

[#238](https://github.com/ArchonVII/archon-setup/issues/238) already foresaw the fleet question — its Targets section scopes the "wider fleet (archon, jma-ui, hudson-bend, pigafetta)" **explicitly OUT** and defers them to "a follow-up lane when OS scope expands." The decision is therefore **not** "amend #238 to add archon" — it's to ratify a three-tier model and decide whether to open that follow-up lane now.

**Recommended model:**

| Tier | Meaning | Repos | Friction ledger? |
|---|---|---|---|
| **OS core / meta-layer** | Builds, distributes, governs the OS | `github-workflows`, `archon-setup`, `.github`, `repo-template` (source), `jma-skill-review` | Yes — this is #238's scope |
| **First-party fleet / consumers** | Real products built *on* the OS; richest source of real friction | `archon` (flagship terminal) first, then `hudson-bend`, `jma-history`, `jma-ui`, `pigafetta` | Yes — via a follow-up "fleet expansion" lane |
| **External / later adopters** | Outside users after the npm publish | n/a yet | Later, post-publish |

This keeps the 2026-06-12 roadmap's OS-core scope intact while giving `archon` — the **most actively developed repo in the org** and a **full OS consumer** (its `C:\GitHub\archon\.github\archon-setup.json` shows it onboarded with `workflow.required-gate`, `workflow.pr-policy`, `agent-workflow.anomaly-triage`, `agent-workflow.doc-sweep`, `agent-workflow.check-map`, `agent-lifecycle.baseline`, and more) — a first-class place in telemetry. The OS currently instruments everything *except* the repo generating the most agent activity.

---

## 3. Decision A — authorize the core rollout (#238)

This is the action that starts the telemetry clock. [#238](https://github.com/ArchonVII/archon-setup/issues/238) is well-formed and ready; it needs your go, not more design.

**Targets (core):** `github-workflows`, `archon-setup` (self-apply), `.github`. `repo-template` = source (verify only). `jma-skill-review` = your call at apply time (it has its own AGENTS.md governance — include only on explicit confirmation).

**Mechanics (per #238, unchanged):** dry-run first via the `archon-ecosystem-sync` / [#219](https://github.com/ArchonVII/archon-setup/issues/219) distributor pattern → present dry-run → apply only on explicit go. Per repo, install: `.claude/friction.md` seed (exact contract header below), one AGENTS.md managed instruction line ("log friction, don't fix; anomaly-vs-friction boundary"), hook append-log allowlist coverage, gitignore exception.

**Contract header to seed (from `C:\GitHub\repo-template\.claude\friction.md`):**
```
<!-- Log non-bug workflow hiccups here; category = tooling | docs | skill | hook | ci | env; cost = rerun | blocked | context-burn | none. Keep each cell one line. -->
| date | category | what happened | cost | suggested fix |
```

**Acceptance (owner-specified on #238):** ledger present with exact header in every target; AGENTS instruction present; hook allowlist verified (ledger append passes, non-ledger `.claude/` change still blocked); clean post-apply `git status`; **timestamp recorded in `docs/CURRENT_WORK.md` and on epic #229** (this is the clock-start); explicit list of repos NOT covered in the closing comment (no false-coverage claims).

---

## 4. Decision B — open the first-party fleet lane (archon first)?

**Recommendation: yes, file it now, apply after the core rollout is verified.** Reasons:

- `archon` is the richest friction source and is already fully OS-instrumented, so the data has the highest value-per-repo.
- It must be a **marker-based granular add** ([#145](https://github.com/ArchonVII/archon-setup/issues/145) / [#219](https://github.com/ArchonVII/archon-setup/issues/219) "repo-owned by default" distributor), **not a re-onboard.** `archon`'s snapshot pins are old (`githubWorkflows` `v1@fef8aec` and `repoTemplate` `main@6a8fda9`, both captured 2026-06-09) — older than the friction contract (repo-template, 2026-06-12). A full snapshot refresh would drag in unrelated drift; only `.claude/friction.md` + the AGENTS line should land.
- Keep its telemetry window **separate** from the core window so the two-week clocks aren't conflated.

**Do NOT** silently widen #238's body to include archon — file a distinct follow-up issue ("feat(distribution): first-party fleet friction-ledger rollout — archon, then hudson-bend/jma-history/jma-ui/pigafetta") under epic #229, so coverage claims stay honest.

---

## 5. What I need from you (authorization checklist)

- [ ] **Ratify the three-tier taxonomy** (§2), or amend it.
- [ ] **Authorize #238 core rollout** — and say whether `jma-skill-review` is in or out this pass.
- [ ] **Approve filing the first-party fleet lane** (§4) with `archon` as member #1 (apply gated separately).
- [ ] Confirm I should **post this packet as a comment on [#238](https://github.com/ArchonVII/archon-setup/issues/238)** and/or commit this doc to `archon-setup` main via the owner-maintenance add-only lane.

On your go, the next agent runs the dry-run, presents it, and only then applies — recording the clock-start timestamp on #229 and in `CURRENT_WORK.md`.
