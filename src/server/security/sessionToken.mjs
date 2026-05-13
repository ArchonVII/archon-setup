import { randomBytes } from "node:crypto";

let currentToken = null;

export function generateSessionToken() {
  currentToken = randomBytes(32).toString("hex");
  return currentToken;
}

export function getSessionToken() {
  if (!currentToken) throw new Error("Session token not initialised");
  return currentToken;
}

export function verifySessionToken(candidate) {
  if (!currentToken || !candidate) return false;
  if (candidate.length !== currentToken.length) return false;
  let mismatch = 0;
  for (let i = 0; i < currentToken.length; i++) {
    mismatch |= currentToken.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return mismatch === 0;
}
