import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config.ts";

export const SESSION_COOKIE = "nacli_session";

interface SessionClaims {
  u: string;
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Compare against itself on length mismatch so timing does not leak length.
  return timingSafeEqual(ab, ab.length === bb.length ? bb : ab) && ab.length === bb.length;
}

export function createSession(cfg: AppConfig, username: string): string {
  const payload = b64(JSON.stringify({ u: username, exp: Date.now() + cfg.sessionTtlMs }));
  return `${payload}.${sign(payload, cfg.sessionSecret)}`;
}

/** Returns the username for a valid, unexpired session whose user still exists. */
export function verifySession(cfg: AppConfig, token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload, cfg.sessionSecret))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionClaims;
    if (claims.exp < Date.now()) return null;
    // Removing a user from config.toml ends their sessions on reload.
    return cfg.users.some((u) => u.username === claims.u) ? claims.u : null;
  } catch {
    return null;
  }
}

export function checkCredentials(cfg: AppConfig, username: string, password: string): boolean {
  let ok = false;
  for (const u of cfg.users) {
    // Evaluate every user so the response time does not reveal which exist.
    if (safeEqual(u.username, username) && safeEqual(u.password, password)) ok = true;
  }
  return ok;
}

/** Simple fixed-window limiter for login attempts per client IP. */
const attempts = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 10;

export function loginAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) return true;
  return entry.count < MAX_ATTEMPTS;
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) attempts.set(ip, { count: 1, reset: now + WINDOW_MS });
  else entry.count++;
}

export function clearFailedLogins(ip: string): void {
  attempts.delete(ip);
}
