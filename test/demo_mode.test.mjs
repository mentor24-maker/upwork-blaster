// Demo mode (UB-27): a separate database file, a banner on every page, and a
// switch behind the password gate. Made-up jobs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatabaseSync } from 'node:sqlite';
import { databasePath, demoDatabasePath, openDatabase, runMigrations } from '../lib/db.ts';
import { appDatabase } from '../lib/app_db.ts';
import { currentMode, DEMO_BANNER_TEXT, ModeBar, setMode } from '../lib/mode.ts';
import { listJobs } from '../lib/jobs.ts';
import { gate } from '../lib/gate.ts';
import { POST as postJob } from '../app/api/jobs/route.ts';
import { POST as postMode } from '../app/api/mode/route.ts';
import { useAiDepsForTests } from '../lib/extractJob.ts';

useAiDepsForTests({ getKey: () => '', fetchImpl: async () => { throw new Error('no test calls the real API'); } });

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
// realpath: macOS reaches the temp folder through /private, which SQLite reports.
const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'ub-demo-test-')));

const form = (obj) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
};
const post = (path, obj) => new Request(`http://localhost${path}`, { method: 'POST', body: form(obj) });
const job = (id, title) => ({
  url: `https://www.upwork.com/jobs/~01${id}`,
  title,
  description: 'Made-up text for the test.',
  budget: '$500',
});

// The routes use the real process environment, so each test points it at a
// scratch data folder and puts it back after.
function withDataDir(fn) {
  return async () => {
    const dir = scratch();
    const before = process.env.UB_DATA_DIR;
    process.env.UB_DATA_DIR = dir;
    try {
      for (const path of [databasePath(), demoDatabasePath()]) {
        const db = openDatabase(path);
        runMigrations(db);
        db.close();
      }
      await fn(dir);
    } finally {
      if (before === undefined) delete process.env.UB_DATA_DIR;
      else process.env.UB_DATA_DIR = before;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const titlesIn = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare('SELECT title FROM opportunity ORDER BY id').all().map((r) => r.title);
  } finally {
    db.close();
  }
};

test('with nothing set the mode is Manual, and appDatabase opens app.sqlite exactly as before', () => {
  const dir = scratch();
  try {
    const env = { UB_DATA_DIR: dir };
    assert.equal(currentMode(env), 'manual');
    assert.equal(demoDatabasePath(env), join(dir, 'demo.sqlite'));
    assert.notEqual(demoDatabasePath(env), databasePath(env));
    const real = appDatabase(env);
    assert.equal(real.prepare('PRAGMA database_list').get().file, join(dir, 'app.sqlite'));

    setMode('demo', env);
    assert.equal(currentMode(env), 'demo');
    const demo = appDatabase(env);
    assert.equal(demo.prepare('PRAGMA database_list').get().file, join(dir, 'demo.sqlite'));

    setMode('manual', env);
    assert.equal(appDatabase(env), real, 'back to the same real database');

    for (const junk of ['', 'not json', '{"mode":"DEMO"}', '{"mode":true}', '[]', 'null']) {
      writeFileSync(join(dir, 'mode.json'), junk);
      assert.equal(currentMode(env), 'manual', `a mode file reading ${JSON.stringify(junk)} means Manual`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a job saved in Demo mode never reaches the real database or the Manual jobs list, and the reverse', withDataDir(async () => {
  // A real job, in Manual mode.
  assert.equal((await postJob(post('/api/jobs', job('aaaa0000111122223333', 'A real-looking made-up job')))).status, 303);

  // Switch to Demo with the switch itself, and save a demo job.
  const toDemo = await postMode(post('/api/mode', { mode: 'demo' }));
  assert.equal(toDemo.status, 303);
  assert.equal(currentMode(), 'demo');
  // Switching on loads the made-up jobs (UB-30, test/demo_data.test.mjs); the real job is not among them.
  const madeUp = listJobs(appDatabase()).map((j) => j.title);
  assert.ok(!madeUp.includes('A real-looking made-up job'), 'the real job is not shown in Demo');
  assert.equal((await postJob(post('/api/jobs', job('bbbb0000111122223333', 'A demo job')))).status, 303);
  assert.deepEqual(listJobs(appDatabase()).map((j) => j.title), ['A demo job', ...madeUp]);

  // Back to Manual: the demo job is gone from the list and was never in the real file.
  assert.equal((await postMode(post('/api/mode', { mode: 'manual' }))).status, 303);
  assert.equal(currentMode(), 'manual');
  assert.deepEqual(listJobs(appDatabase()).map((j) => j.title), ['A real-looking made-up job']);
  assert.deepEqual(titlesIn(databasePath()), ['A real-looking made-up job']);
  assert.deepEqual(titlesIn(demoDatabasePath()), [...[...madeUp].reverse(), 'A demo job']);
}));

test('the switch refuses anything but demo or manual, and changes nothing', withDataDir(async () => {
  for (const bad of [{ mode: 'DEMO' }, { mode: '' }, {}]) {
    const res = await postMode(post('/api/mode', bad));
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /error=bad-mode/);
    assert.equal(currentMode(), 'manual');
  }
}));

test('in Demo mode the banner shows on the page; in Manual mode there is no banner', () => {
  const demo = renderToStaticMarkup(createElement(ModeBar, { mode: 'demo' }));
  assert.ok(demo.includes(DEMO_BANNER_TEXT), demo);
  assert.match(demo, /value="manual"/, 'it offers the way back to Manual');

  const manual = renderToStaticMarkup(createElement(ModeBar, { mode: 'manual' }));
  assert.ok(!manual.includes(DEMO_BANNER_TEXT), manual);
  assert.doesNotMatch(manual, /DEMO MODE/);
  assert.match(manual, /value="demo"/, 'it offers the switch to Demo');

  const signedOutDemo = renderToStaticMarkup(createElement(ModeBar, { mode: 'demo', canSwitch: false }));
  assert.ok(signedOutDemo.includes(DEMO_BANNER_TEXT), 'the banner shows even on the sign-in page');
  assert.doesNotMatch(signedOutDemo, /<form/, 'but the switch is only for a signed-in browser');
  assert.equal(renderToStaticMarkup(createElement(ModeBar, { mode: 'manual', canSwitch: false })), '');

  // The layout, which every page renders inside, draws the bar with the mode in force.
  const layout = readFileSync(join(repo, 'app/layout.tsx'), 'utf8');
  assert.match(layout, /<ModeBar mode=\{currentMode\(\)\}/);
});

test('the switch is refused without signing in', () => {
  const env = { APP_PASSWORD: 'made-up-password', APP_SESSION_SECRET: 'made-up-secret-made-up-secret-0123' };
  const res = gate(new Request('http://localhost/api/mode', { method: 'POST', body: form({ mode: 'demo' }) }), env);
  assert.ok(res, 'the gate answers instead of letting it through');
  assert.equal(res.status, 401);
});

test('npm run db:migrate reports on both files, and the backup copies only app.sqlite', () => {
  const dir = scratch();
  try {
    const env = { ...process.env, UB_DATA_DIR: dir };
    const run = (cmd) =>
      execFileSync('node', ['--disable-warning=ExperimentalWarning', join(repo, 'scripts/db.ts'), cmd], { env, encoding: 'utf8' });
    const out = run('migrate');
    assert.match(out, new RegExp(`${join(dir, 'app.sqlite')}: ran 001_`));
    assert.match(out, new RegExp(`${join(dir, 'demo.sqlite')}: ran 001_`));
    assert.match(run('migrate'), /demo\.sqlite: already up to date/);

    // Put a row in each, then back up: the copy holds only the real one.
    const put = (path, title) => {
      const db = new DatabaseSync(path);
      db.prepare('INSERT INTO opportunity (url, title, description) VALUES (?, ?, ?)').run(`https://www.upwork.com/jobs/~01${title.length}x`, title, 'Made up.');
      db.close();
    };
    put(join(dir, 'app.sqlite'), 'real one');
    put(join(dir, 'demo.sqlite'), 'demo one here');
    run('backup');
    const copies = readdirSync(join(dir, 'backups'));
    assert.equal(copies.length, 1);
    assert.match(copies[0], /^app-/);
    assert.deepEqual(titlesIn(join(dir, 'backups', copies[0])), ['real one']);
    assert.ok(existsSync(join(dir, 'demo.sqlite')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
