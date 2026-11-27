// The activity log (lib/activity.ts, the /activity page): each save writes
// one plain-English line saying who did what, shown newest first in Mountain
// time. No secret may ever reach it: the app password, the session key, a
// session cookie or the AI key. Every value here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, REPO_DIR, runMigrations } from '../lib/db.ts';
import {
  activityLines,
  activityLink,
  activityWhen,
  HIDDEN,
  listActivity,
  logActivity,
  MAX_SUMMARY,
  scrubSecrets,
} from '../lib/activity.ts';
import { saveJob } from '../lib/jobs.ts';
import { recordDecision } from '../lib/inbox.ts';
import { createSessionToken, SESSION_COOKIE } from '../lib/session.ts';
import { POST as signIn } from '../app/api/sign-in/route.ts';
import { POST as postCopied } from '../app/api/copied/route.ts';

const PASSWORD = 'made-up-activity-password';
const SECRET = 'made-up-activity-session-secret';
const KEY = 'sk-ant-made-up-activity-key-1234';

function freshDb() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const job = (over = {}) => ({
  url: 'https://www.upwork.com/jobs/~01activitytest0001',
  title: 'Made-up sales dashboard',
  description: 'We need a sales dashboard in Next.js.',
  budget: null,
  jobType: null,
  postedAt: null,
  client: null,
  connectsCost: null,
  ...over,
});

/** Run `fn` with the app's secrets (and a data folder) set as given, then put them back. */
async function withEnv(env, fn) {
  const names = ['APP_PASSWORD', 'APP_SESSION_SECRET', 'ANTHROPIC_API_KEY', 'UB_DATA_DIR'];
  const saved = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  for (const k of names) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
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

test('a secret in a line is hidden: our three by value, and anything shaped like a key or a session cookie', () => {
  const env = { APP_PASSWORD: PASSWORD, APP_SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: KEY };
  const cookie = createSessionToken({ password: PASSWORD, secret: SECRET }, 1_790_000_000_000);
  const text = `pw ${PASSWORD}, key ${SECRET}, ai ${KEY}, other sk-ant-someone-elses-key, cookie ${cookie}.`;
  const out = scrubSecrets(text, env);
  for (const s of [PASSWORD, SECRET, KEY, 'sk-ant-someone-elses-key', cookie]) assert.ok(!out.includes(s), s);
  assert.equal(out, `pw ${HIDDEN}, key ${HIDDEN}, ai ${HIDDEN}, other ${HIDDEN}, cookie ${HIDDEN}.`);
  assert.equal(scrubSecrets('You saved the job “A dashboard”.', env), 'You saved the job “A dashboard”.', 'ordinary words are left alone');
  assert.equal(scrubSecrets('a b c', { APP_PASSWORD: 'b' }), 'a b c', 'a value too short to be a real secret hides nothing');
});

test('a job whose title holds a secret is logged with it hidden', async () => {
  await withEnv({ APP_PASSWORD: PASSWORD, APP_SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: KEY }, () => {
    const db = freshDb();
    const saved = saveJob(db, job({ title: `Dashboard ${PASSWORD} ${KEY} ${SECRET}` }));
    assert.ok(saved.ok);
    const all = JSON.stringify(db.prepare('SELECT * FROM activity_event').all());
    for (const s of [PASSWORD, SECRET, KEY]) assert.ok(!all.includes(s), s);
    assert.match(listActivity(db)[0].summary, /^You saved the job “Dashboard \[hidden\] \[hidden\] \[hidden\]”\.$/);
  });
});

test('lines read newest first, say who, and link to what they are about', () => {
  const db = freshDb();
  const saved = saveJob(db, job());
  assert.ok(saved.ok);
  recordDecision(db, saved.id, 'pass');
  logActivity(db, { actor: 'AI', kind: 'test', summary: 'The AI did   a\nthing.' });
  const lines = activityLines(db);
  assert.deepEqual(
    lines.map((l) => [l.who, l.what, l.link]),
    [
      ['The AI', 'The AI did a thing.', null],
      ['You', 'You passed on “Made-up sales dashboard”.', `/jobs#job-${saved.id}`],
      ['You', 'You saved the job “Made-up sales dashboard”.', `/jobs#job-${saved.id}`],
    ],
  );
  assert.equal(activityLink({ opportunityId: 3, proposalId: 7 }), '/proposals/7', 'a proposal line opens the proposal');
});

test('times are shown in Mountain time, summer and winter', () => {
  assert.equal(activityWhen('2026-07-01T18:30:00.000Z'), 'Jul 1, 2026, 12:30 PM MT');
  assert.equal(activityWhen('2026-11-27T16:32:00.000Z'), 'Nov 27, 2026, 9:32 AM MT');
});

test('a long line is cut to the most a line may hold, and a line that cannot be written never costs the save', () => {
  const db = freshDb();
  logActivity(db, { actor: 'Dane', kind: 'test', summary: 'x'.repeat(MAX_SUMMARY * 2) });
  assert.equal(Array.from(listActivity(db)[0].summary).length, MAX_SUMMARY);

  const bare = openDatabase(':memory:'); // no tables at all
  const errors = [];
  const original = console.error;
  console.error = (m) => errors.push(String(m));
  try {
    assert.doesNotThrow(() => logActivity(bare, { actor: 'Dane', kind: 'test', summary: 'Nowhere to go.' }));
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /activity log line "test" could not be written/, 'the failure says so');
});

test('signing in logs "You signed in", a wrong password logs a refusal, and neither holds what was typed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-activity-test-'));
  try {
    const setup = openDatabase(join(dir, 'app.sqlite'));
    runMigrations(setup);
    setup.close();
    const env = { APP_PASSWORD: PASSWORD, APP_SESSION_SECRET: SECRET, UB_DATA_DIR: dir };
    const post = (password) => {
      const body = new FormData();
      body.set('password', password);
      return signIn(new Request('http://mac-mini.local:4280/api/sign-in', { method: 'POST', body }));
    };
    const wrongGuess = 'made-up-wrong-guess-9876';
    const res = await withEnv(env, async () => [await post(wrongGuess), await post(PASSWORD)]);
    const cookie = /ub_session=([^;]+)/.exec(res[1].headers.get('set-cookie'))[1];

    const db = openDatabase(join(dir, 'app.sqlite'));
    assert.deepEqual(
      listActivity(db).map((e) => [e.actor, e.summary]),
      [
        ['Dane', 'You signed in.'],
        ['app', 'A sign-in with the wrong password was refused.'],
      ],
    );
    const all = JSON.stringify(db.prepare('SELECT * FROM activity_event').all());
    for (const s of [PASSWORD, SECRET, wrongGuess, cookie]) assert.ok(!all.includes(s), 'nothing typed or issued is kept');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the copy note is refused signed out, on a bad form and on a proposal not approved, and writes nothing then', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-activity-test-'));
  try {
    const setup = openDatabase(join(dir, 'app.sqlite'));
    runMigrations(setup);
    const saved = saveJob(setup, job());
    const proposal = Number(setup.prepare('INSERT INTO proposal (opportunity_id, draft) VALUES (?, ?)').run(saved.id, 'Hi.').lastInsertRowid);
    const before = listActivity(setup).length;
    setup.close();

    const env = { APP_PASSWORD: PASSWORD, APP_SESSION_SECRET: SECRET, UB_DATA_DIR: dir };
    const cookie = createSessionToken({ password: PASSWORD, secret: SECRET });
    const post = (fields, signedIn = true) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.set(k, v);
      const headers = signedIn ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {};
      return postCopied(new Request('http://mac-mini.local:4280/api/copied', { method: 'POST', body, headers }));
    };
    const statuses = await withEnv(env, async () => [
      (await post({ proposal: String(proposal), part: 'text' }, false)).status,
      (await post({ proposal: 'x', part: 'text' })).status,
      (await post({ proposal: String(proposal), part: 'everything' })).status,
      (await post({ proposal: String(proposal), part: 'text' })).status,
    ]);
    assert.deepEqual(statuses, [401, 400, 400, 404], 'signed out, bad id, bad part, not approved');
    const db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(listActivity(db).length, before, 'no line was written');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Activity page is linked from the home page and shows the lines lib/activity.ts words', () => {
  const home = readFileSync(join(REPO_DIR, 'app/page.tsx'), 'utf8');
  assert.match(home, /<a href="\/activity">Activity<\/a>/);
  const page = readFileSync(join(REPO_DIR, 'app/activity/page.tsx'), 'utf8');
  assert.match(page, /activityLines\(db\)/);
  assert.match(page, /Mountain time/);
});
