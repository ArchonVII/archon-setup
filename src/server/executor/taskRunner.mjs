// Each task module exports:
//   plan(ctx)          -> { description, willWrite: [paths], willRun: [{tool,args}] }
//   check(ctx)         -> "already-done" | "needs-apply" | "blocked"
//   apply(ctx)         -> { result, details }
//   verify(ctx)        -> { ok, details }
//   rollbackHint(ctx)  -> string

import { log } from "../lib/logger.mjs";

export async function runTask(taskModule, ctx) {
  const id = taskModule.id || taskModule.name || "task";
  const events = [];
  function push(kind, payload) {
    const ev = { taskId: id, kind, at: Date.now(), ...payload };
    events.push(ev);
    if (ctx.onEvent) ctx.onEvent(ev);
  }

  push("start");
  try {
    const state = await taskModule.check(ctx);
    push("checked", { state });
    if (state === "already-done") {
      push("done", { result: "skipped" });
      return { ok: true, status: "already-done", events };
    }
    if (state === "blocked") {
      push("done", { result: "blocked" });
      return { ok: false, status: "blocked", events };
    }
    const applied = await taskModule.apply(ctx);
    push("applied", { applied });
    const verified = await taskModule.verify(ctx);
    push("verified", { verified });
    if (!verified.ok) {
      push("done", { result: "verify-failed" });
      return { ok: false, status: "verify-failed", verified, events };
    }
    push("done", { result: "applied" });
    return { ok: true, status: "applied", applied, events };
  } catch (err) {
    log.error("task failed", { taskId: id, error: err.message });
    push("error", { error: err.message });
    push("done", { result: "error" });
    return {
      ok: false,
      status: "error",
      error: err.message,
      rollbackHint: taskModule.rollbackHint ? taskModule.rollbackHint(ctx) : null,
      events,
    };
  }
}
