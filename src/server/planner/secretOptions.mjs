const SENSITIVE_EXACT_KEYS = new Set(["secret", "token", "password", "passwd"]);
const SENSITIVE_KEY_RE = /(?:secret.*value|value.*secret|api[_-]?key|private[_-]?key)/i;

export function isSensitiveOptionKey(key) {
  const normalized = String(key || "").trim();
  return SENSITIVE_EXACT_KEYS.has(normalized.toLowerCase()) || SENSITIVE_KEY_RE.test(normalized);
}

export function stripSensitiveKeysDeep(value) {
  if (Array.isArray(value)) return value.map((item) => stripSensitiveKeysDeep(item));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveOptionKey(key)) continue;
    out[key] = stripSensitiveKeysDeep(nested);
  }
  return out;
}

export function serializableFeatureOptions(feature, supplied = {}) {
  const allowed = new Set(Object.keys(feature.options || {}));
  const out = {};
  for (const [key, value] of Object.entries(supplied || {})) {
    if (!allowed.has(key)) continue;
    if (isSensitiveOptionKey(key)) continue;
    out[key] = stripSensitiveKeysDeep(value);
  }
  return out;
}

export function sanitizeSerializedPlan(plan) {
  const sanitized = stripSensitiveKeysDeep(plan || {});
  return {
    ...sanitized,
    ordered: (sanitized.ordered || []).map((unit) => ({
      ...unit,
      options: stripSensitiveKeysDeep(unit.options || {}),
    })),
  };
}
