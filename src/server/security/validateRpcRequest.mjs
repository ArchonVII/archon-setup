import { verifySessionToken } from "./sessionToken.mjs";

export function validateRpcRequest(req, expectedHost) {
  // Origin / Host pinning
  const host = req.headers.host;
  if (host !== expectedHost) {
    return { ok: false, status: 403, reason: "bad host" };
  }
  const origin = req.headers.origin;
  if (origin && origin !== `http://${expectedHost}`) {
    return { ok: false, status: 403, reason: "bad origin" };
  }

  // Session token (Authorization: Bearer <token>)
  const auth = req.headers.authorization || "";
  const m = /^Bearer (.+)$/.exec(auth);
  const token = m ? m[1] : null;
  if (!verifySessionToken(token)) {
    return { ok: false, status: 401, reason: "bad token" };
  }

  // State-changing methods must be POST
  if (req.method !== "GET" && req.method !== "POST") {
    return { ok: false, status: 405, reason: "method not allowed" };
  }

  return { ok: true };
}
