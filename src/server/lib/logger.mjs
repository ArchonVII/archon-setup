// Minimal logger. Never logs values flagged as secret.
// Pass { secret: true } in fields to redact a value.

const REDACT = "[redacted]";

function fmt(level, msg, fields = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v && typeof v === "object" && v.secret === true) safe[k] = REDACT;
    else safe[k] = v;
  }
  return JSON.stringify({ t: new Date().toISOString(), level, msg, ...safe });
}

export const log = {
  info: (msg, fields) => console.log(fmt("info", msg, fields)),
  warn: (msg, fields) => console.warn(fmt("warn", msg, fields)),
  error: (msg, fields) => console.error(fmt("error", msg, fields)),
};
