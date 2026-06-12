// src/server/ecosystem/portPolicy.mjs
//
// Dev-port reservation policy for registry entries (#214, spec §4.5 in
// docs/superpowers/specs/2026-06-12-ecosystem-registry-and-maintenance-design.md).
// Reservations are explicit port lists on registry entries; this module is the
// single validation point the store (and later the CRUD RPC) calls before any
// overlay write.

// 5173 is Vite's default port and the cross-repo collision magnet — banned by
// owner instruction (C:\GitHub\user-plan.md; spec §4.5).
export const FORBIDDEN_PORTS = [5173];

// Standard ecosystem dev-server range (spec §4.5 owner decision). Outside the
// range is a warning, not an error, so non-web tooling can still reserve.
export const STANDARD_DEV_PORT_RANGE = { min: 5170, max: 5999 };

// TCP port bounds (RFC 793 16-bit port space; 0 is not bindable by name).
const PORT_MIN = 1;
const PORT_MAX = 65535;

function isValidPortNumber(port) {
  return Number.isInteger(port) && port >= PORT_MIN && port <= PORT_MAX;
}

function reservationIndex(registry, excludeId) {
  const byPort = new Map();
  for (const entry of registry?.repositories ?? []) {
    if (entry.lifecycle === "removed") continue;
    if (excludeId && entry.id === excludeId) continue;
    for (const port of entry.reservedPorts ?? []) {
      if (!byPort.has(port)) byPort.set(port, entry.id);
    }
  }
  return byPort;
}

// Validates a proposed reservation list against the effective registry.
// Returns { ok, errors: [{code, port, detail}], warnings: [{code, port, detail}] }.
// excludeId skips the entry being edited so self-updates don't conflict.
export function validatePortAssignment(ports, registry, { excludeId = null } = {}) {
  const errors = [];
  const warnings = [];
  const reserved = reservationIndex(registry, excludeId);
  const seen = new Set();

  for (const port of ports ?? []) {
    if (!isValidPortNumber(port)) {
      errors.push({ code: "port-invalid", port, detail: `port must be an integer in ${PORT_MIN}-${PORT_MAX}` });
      continue;
    }
    if (seen.has(port)) {
      errors.push({ code: "port-duplicate", port, detail: "port listed twice in the same reservation" });
      continue;
    }
    seen.add(port);
    if (FORBIDDEN_PORTS.includes(port)) {
      errors.push({ code: "port-forbidden", port, detail: "forbidden port (Vite default; owner ban)" });
      continue;
    }
    const owner = reserved.get(port);
    if (owner) {
      errors.push({ code: "port-conflict", port, detail: `already reserved by "${owner}"` });
      continue;
    }
    if (port < STANDARD_DEV_PORT_RANGE.min || port > STANDARD_DEV_PORT_RANGE.max) {
      warnings.push({
        code: "port-out-of-range",
        port,
        detail: `outside the standard dev range ${STANDARD_DEV_PORT_RANGE.min}-${STANDARD_DEV_PORT_RANGE.max}`,
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// Entry-level check: reservation list plus devServer.primaryPort membership.
export function validateEntryPorts(entry, registry, { excludeId = entry?.id ?? null } = {}) {
  const result = validatePortAssignment(entry?.reservedPorts ?? [], registry, { excludeId });
  const primaryPort = entry?.devServer?.primaryPort;
  if (primaryPort !== undefined && !(entry?.reservedPorts ?? []).includes(primaryPort)) {
    result.errors.push({
      code: "dev-server-port-unreserved",
      port: primaryPort,
      detail: "devServer.primaryPort must be one of the entry's reservedPorts",
    });
    result.ok = false;
  }
  return result;
}
