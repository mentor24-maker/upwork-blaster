/**
 * The app's one lock (plan decision D3): a single password, and a signed
 * cookie that says "this browser typed it".
 *
 * Nothing here imports Next.js, so the tests run it directly under
 * `node --test`. Both values come from Doppler (project `upwork-blaster`) at
 * run time and are never written to a log, a page or the repository:
 *
 *   APP_PASSWORD        what Dane types on the sign-in page
 *   APP_SESSION_SECRET  the key that signs the cookie; changing it signs
 *                       every browser out
 *
 * When either one is missing, nobody can sign in and nobody is signed in:
 * the lock fails shut, never open.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'ub_session';
/** How long one sign-in lasts: 30 days. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type AuthConfig = { password: string; secret: string };

type Env = Record<string, string | undefined>;

/** The password and cookie key, or null when either is not set up. */
export function readAuthConfig(env: Env = process.env): AuthConfig | null {
  const password = env.APP_PASSWORD ?? '';
  const secret = env.APP_SESSION_SECRET ?? '';
  if (!password || !secret) return null;
  return { password, secret };
}

/** Whether `given` is the password, compared in constant time. */
export function passwordMatches(given: string, expected: string): boolean {
  if (!expected) return false;
  // Hash both first, so the comparison takes the same time whatever their lengths.
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function sign(issuedAt: string, secret: string): string {
  return createHmac('sha256', secret).update(`ub-session.${issuedAt}`).digest('base64url');
}

/** A cookie value proving a sign-in at `now`: "<issued-at ms>.<signature>". */
export function createSessionToken(secret: string, now: number = Date.now()): string {
  const issuedAt = String(Math.floor(now));
  return `${issuedAt}.${sign(issuedAt, secret)}`;
}

/** Whether a cookie value was signed with `secret` and has not run out. */
export function isValidSessionToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!token || !secret) return false;
  const match = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const [, issuedAt, signature] = match;
  const expected = Buffer.from(sign(issuedAt, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  const age = now - Number(issuedAt);
  return age >= 0 && age < SESSION_MAX_AGE_SECONDS * 1000;
}

/** One cookie's value out of a `Cookie:` request header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Whether this request carries a valid sign-in cookie. */
export function isSignedIn(request: Request, env: Env = process.env, now: number = Date.now()): boolean {
  const config = readAuthConfig(env);
  if (!config) return false;
  return isValidSessionToken(readCookie(request.headers.get('cookie'), SESSION_COOKIE), config.secret, now);
}

/**
 * The Set-Cookie value for a sign-in (or, with `token` null, a sign-out).
 * HttpOnly keeps page scripts from reading it; SameSite=Lax keeps another
 * site from sending it with a form. No `Secure` flag: the app is served over
 * plain http on the home network, where a Secure cookie is never sent back.
 */
export function sessionCookieHeader(token: string | null): string {
  const maxAge = token ? SESSION_MAX_AGE_SECONDS : 0;
  return `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
