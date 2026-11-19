import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate } from '../lib/gate.ts';
import {
  createSessionToken,
  isValidSessionToken,
  passwordMatches,
  readAuthConfig,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../lib/session.ts';
import { signInMessage } from '../lib/sign_in_messages.ts';
import { POST as signIn } from '../app/api/sign-in/route.ts';
import { POST as signOut } from '../app/api/sign-out/route.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

// Made-up values for the tests only; the real ones live in Doppler.
const PASSWORD = 'test-only-password';
const SECRET = 'test-only-session-secret';
const ENV = { APP_PASSWORD: PASSWORD, APP_SESSION_SECRET: SECRET };
const CONFIG = { password: PASSWORD, secret: SECRET };

const req = (path, { method = 'GET', headers = {}, body } = {}) =>
  new Request(`http://mac-mini.local:4280${path}`, { method, headers, body });
const withCookie = (token, headers = {}) => ({ ...headers, cookie: `other=1; ${SESSION_COOKIE}=${token}` });
const form = (password) => {
  const body = new FormData();
  body.set('password', password);
  return body;
};

/** Run a route handler with the app's two secrets set as given. */
async function withEnv(env, fn) {
  const saved = { APP_PASSWORD: process.env.APP_PASSWORD, APP_SESSION_SECRET: process.env.APP_SESSION_SECRET };
  for (const [k, v] of Object.entries({ APP_PASSWORD: undefined, APP_SESSION_SECRET: undefined, ...env })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── signed out: nothing gets through ──────────────────────────────────────

test('a signed-out visit to a page is sent to the sign-in page with no body', async () => {
  for (const path of ['/', '/jobs/123', '/anything?x=1']) {
    const res = gate(req(path), ENV);
    assert.equal(res?.status, 307, path);
    assert.equal(res.headers.get('location'), 'http://mac-mini.local:4280/sign-in', 'a full address, on the host the visitor used');
    assert.equal(await res.text(), '', 'no page content');
  }
});

test('a signed-out server action gets nothing, on any path, the sign-in page included', async () => {
  for (const path of ['/', '/sign-in', '/api/sign-in', '/jobs']) {
    const res = gate(req(path, { method: 'POST', headers: { 'next-action': 'abc123' }, body: '[]' }), ENV);
    assert.equal(res?.status, 401, path);
    assert.equal(await res.text(), '');
  }
  // A server action sent as a GET is refused too, not redirected through.
  assert.equal(gate(req('/sign-in', { headers: { 'next-action': 'abc123' } }), ENV)?.status, 401);
});

test('a signed-out post or API call anywhere but the sign-in form gets an empty 401', async () => {
  for (const [path, method] of [['/', 'POST'], ['/api/sign-out', 'POST'], ['/api/anything', 'PUT'], ['/sign-in', 'POST']]) {
    const res = gate(req(path, { method }), ENV);
    assert.equal(res?.status, 401, `${method} ${path}`);
    assert.equal(await res.text(), '');
  }
});

test('a signed-out visitor may open the sign-in page and send its form', () => {
  assert.equal(gate(req('/sign-in'), ENV), undefined);
  assert.equal(gate(req('/sign-in?error=wrong'), ENV), undefined);
  assert.equal(gate(req('/api/sign-in', { method: 'POST' }), ENV), undefined);
});

test('a forged, foreign or expired cookie counts as signed out', () => {
  const now = Date.now();
  const forged = `${now}.${'A'.repeat(43)}`;
  const foreign = createSessionToken({ password: PASSWORD, secret: 'some-other-secret' }, now);
  const expired = createSessionToken(CONFIG, now - SESSION_MAX_AGE_SECONDS * 1000 - 1);
  const future = createSessionToken(CONFIG, now + 60_000);
  for (const token of [forged, foreign, expired, future, '', 'garbage', `${now}`]) {
    assert.equal(gate(req('/', { headers: withCookie(token) }), ENV, now)?.status, 307, token);
  }
});

test('changing the password signs every browser out', () => {
  const now = Date.now();
  const before = createSessionToken(CONFIG, now);
  assert.equal(gate(req('/', { headers: withCookie(before) }), ENV, now), undefined, 'in, under the old password');
  const changed = { ...ENV, APP_PASSWORD: 'test-only-new-password' };
  assert.equal(gate(req('/', { headers: withCookie(before) }), changed, now)?.status, 307, 'out, once it changes');
  assert.equal(isValidSessionToken(before, { password: 'test-only-new-password', secret: SECRET }, now), false);
  const after = createSessionToken({ password: 'test-only-new-password', secret: SECRET }, now);
  assert.equal(gate(req('/', { headers: withCookie(after) }), changed, now), undefined, 'a new sign-in works');
});

test('changing the cookie key signs every browser out too', () => {
  const now = Date.now();
  const before = createSessionToken(CONFIG, now);
  assert.equal(gate(req('/', { headers: withCookie(before) }), { ...ENV, APP_SESSION_SECRET: 'test-only-new-secret' }, now)?.status, 307);
});

test('with the password or the cookie key missing from Doppler, nobody is let in', () => {
  const good = createSessionToken(CONFIG);
  for (const env of [{}, { APP_PASSWORD: PASSWORD }, { APP_SESSION_SECRET: SECRET }]) {
    assert.equal(readAuthConfig(env), null);
    assert.equal(gate(req('/', { headers: withCookie(good) }), env)?.status, 307);
  }
});

// ── the password itself ───────────────────────────────────────────────────

test('only the exact password matches', () => {
  assert.equal(passwordMatches(PASSWORD, PASSWORD), true);
  for (const wrong of ['', 'test-only-passwor', `${PASSWORD} `, PASSWORD.toUpperCase(), 'x'.repeat(500)]) {
    assert.equal(passwordMatches(wrong, PASSWORD), false, wrong);
  }
  assert.equal(passwordMatches('', ''), false, 'an empty password never matches');
});

test('a wrong password gets nothing: back to the sign-in page, no cookie', async () => {
  for (const given of ['nope', '', `${PASSWORD}x`]) {
    const res = await withEnv(ENV, () => signIn(req('/api/sign-in', { method: 'POST', body: form(given) })));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/sign-in?error=wrong');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(await res.text(), '');
  }
  const empty = await withEnv(ENV, () => signIn(req('/api/sign-in', { method: 'POST' })));
  assert.equal(empty.headers.get('set-cookie'), null, 'no form at all is a wrong password too');
});

test('the right password gets in: a signed cookie, then the home page opens', async () => {
  const res = await withEnv(ENV, () => signIn(req('/api/sign-in', { method: 'POST', body: form(PASSWORD) })));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=[^;]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}$`));
  assert.ok(!cookie.includes(PASSWORD) && !cookie.includes(SECRET), 'the cookie carries neither secret');

  const token = cookie.split(';')[0].slice(SESSION_COOKIE.length + 1);
  assert.ok(isValidSessionToken(token, CONFIG));
  assert.equal(gate(req('/', { headers: withCookie(token) }), ENV), undefined, 'home page opens');
  assert.equal(
    gate(req('/', { method: 'POST', headers: withCookie(token, { 'next-action': 'abc123' }) }), ENV),
    undefined,
    'server actions run once signed in',
  );
  assert.equal(gate(req('/sign-in', { headers: withCookie(token) }), ENV)?.headers.get('location'), 'http://mac-mini.local:4280/');
});

test('with no password set up, the sign-in form says so and lets nobody in', async () => {
  const res = await withEnv({ APP_SESSION_SECRET: SECRET }, () =>
    signIn(req('/api/sign-in', { method: 'POST', body: form('') })),
  );
  assert.equal(res.headers.get('location'), '/sign-in?error=not-set-up');
  assert.equal(res.headers.get('set-cookie'), null);
});

test('the sign-in page shows only its own messages, whatever the address says', () => {
  assert.equal(signInMessage('wrong', true), 'That password is not right. Try again.');
  assert.match(signInMessage('not-set-up', true), /not set up/);
  assert.match(signInMessage(undefined, false), /not set up/, 'no keys: it says so whatever the address');
  for (const error of [undefined, '', 'nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', ['wrong', 'wrong']]) {
    assert.equal(signInMessage(error, true), undefined, String(error));
  }
});

test('signing out clears the cookie and goes back to the sign-in page', async () => {
  const res = await signOut();
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/sign-in');
  assert.match(res.headers.get('set-cookie'), new RegExp(`^${SESSION_COOKIE}=; .*Max-Age=0$`));
});

// ── the wiring ────────────────────────────────────────────────────────────

test('the gate runs on every path but the built page assets', async () => {
  const { config, proxy } = await import('../proxy.ts');
  assert.deepEqual(config.matcher, ['/((?!_next/static/|_next/image$|_next/image/|favicon\\.ico$).*)']);
  // The same exclusions, as Next.js reads them against a path.
  const pattern = new RegExp(`^${config.matcher[0]}$`);
  const meetsGate = (path) => pattern.test(path);
  for (const path of ['/', '/favicon.icoX', '/favicon.ico/x', '/_next/staticX', '/_next/imageX', '/sign-in']) {
    assert.ok(meetsGate(path), `${path} meets the gate`);
  }
  for (const path of ['/favicon.ico', '/_next/static/chunks/a.js', '/_next/image']) {
    assert.ok(!meetsGate(path), `${path} skips the gate (no data there)`);
  }
  assert.equal(proxy(req('/'))?.status, 307, 'proxy.ts calls the gate');
});

test('the app service reads its secrets from Doppler, and nothing prints them', () => {
  const runApp = readFileSync(join(repo, 'scripts/run_app.sh'), 'utf8');
  assert.match(runApp, /exec doppler run --project "\$DOPPLER_PROJECT" --config "\$DOPPLER_CONFIG"/);
  for (const file of ['lib/session.ts', 'lib/gate.ts', 'proxy.ts', 'app/api/sign-in/route.ts', 'app/sign-in/page.tsx', 'app/layout.tsx', 'lib/sign_in_messages.ts']) {
    const src = readFileSync(join(repo, file), 'utf8');
    assert.doesNotMatch(src, /console\.|process\.stdout|process\.stderr/, `${file} writes nothing to a log`);
  }
});
