// Demo mode's made-up data (UB-30): switching Demo on fills the demo
// database with the end-to-end test's made-up jobs and portfolio, scored and
// ranked, never the real one, and never with a call to the Claude API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatabaseSync } from 'node:sqlite';
import { databasePath, demoDatabasePath, openDatabase, runMigrations } from '../lib/db.ts';
import { appDatabase } from '../lib/app_db.ts';
import { currentMode, ModeBar, RELOAD_LABEL, setMode } from '../lib/mode.ts';
import { DEMO_JOBS, DEMO_PORTFOLIO, emptyDemoDatabase, loadDemoData, reloadDemoData } from '../lib/demo.ts';
import { listJobs, saveJob } from '../lib/jobs.ts';
import { listEntries } from '../lib/portfolio.ts';
import { buildInbox } from '../lib/inbox.ts';
import { useAiDepsForTests } from '../lib/extractJob.ts';
import { POST as postMode } from '../app/api/mode/route.ts';
import { POST as postDemo } from '../app/api/demo/route.ts';

// Any request at all while loading is a failure: the AI's door and fetch itself.
const calls = [];
useAiDepsForTests({ getKey: () => '', fetchImpl: async (url) => { calls.push(String(url)); throw new Error('no AI call in Demo mode'); } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error('no request in Demo mode'); };
test.after(() => { globalThis.fetch = realFetch; });

const fixture = (name) => JSON.parse(readFileSync(new URL(`./e2e/fixtures/${name}`, import.meta.url), 'utf8'));
const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'ub-demo-data-')));
const modeForm = (mode) => {
  const f = new FormData();
  f.set('mode', mode);
  return new Request('http://localhost/api/mode', { method: 'POST', body: f });
};

// The routes use the real process environment, so each test points it at a
// scratch data folder (both files migrated) and puts it back after.
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

const counts = (db) => ({ jobs: listJobs(db).length, entries: listEntries(db).length });

test('the loader reads the same fixtures the end-to-end test uses, unchanged', () => {
  assert.deepEqual(DEMO_JOBS, fixture('jobs.json').jobs);
  assert.deepEqual(DEMO_PORTFOLIO, fixture('portfolio.json').entries);
});

test('switching Demo on fills the demo database: every job saved and scored, the excluded ones set apart, both portfolio entries', withDataDir(async () => {
  const res = await postMode(modeForm('demo'));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/jobs?demo=loaded');
  assert.equal(currentMode(), 'demo');

  const db = appDatabase();
  const jobs = listJobs(db);
  assert.deepEqual(jobs.map((j) => j.title).sort(), DEMO_JOBS.map((j) => j.title).sort(), 'every made-up job is on the Jobs page');
  const strong = jobs.find((j) => j.title === 'Made-up sales dashboard for a bakery chain');
  assert.deepEqual([strong.budget, strong.jobType], ['$3,000', 'fixed'], 'saved with the fields its aiAnswer holds');
  assert.ok(strong.extractedAt, 'marked as read, so the Jobs page does not wait on the AI');
  assert.ok(jobs.every((j) => j.scoringProblem === null));

  const inbox = buildInbox(db);
  assert.equal(inbox.top[0].job.title, 'Made-up sales dashboard for a bakery chain', 'the Inbox starts with the bakery dashboard');
  assert.deepEqual(
    inbox.excluded.map((c) => c.job.title).sort(),
    ['Made-up gambling dashboard', 'Made-up quick theme tweak'],
    'the casino job is shown as excluded (and the WordPress one set apart)',
  );
  assert.deepEqual(listEntries(db).map((e) => e.project), DEMO_PORTFOLIO.map((e) => e.project), 'both portfolio entries');
  assert.deepEqual(calls, [], 'no request was made while loading');
}));

test('loading twice adds nothing: the same jobs and portfolio entries', withDataDir(async () => {
  await postMode(modeForm('demo'));
  const db = appDatabase();
  const first = counts(db);
  assert.deepEqual(first, { jobs: DEMO_JOBS.length, entries: DEMO_PORTFOLIO.length });
  assert.deepEqual(loadDemoData(db), { jobsAdded: 0, entriesAdded: 0, preferencesSaved: false });
  await postMode(modeForm('manual'));
  await postMode(modeForm('demo'));
  assert.deepEqual(counts(appDatabase()), first);
}));

test('demo records never appear in Manual mode or in the real database file', withDataDir(async () => {
  await postMode(modeForm('demo'));
  assert.equal(listJobs(appDatabase()).length, DEMO_JOBS.length);
  await postDemo();
  await postMode(modeForm('manual'));
  assert.equal(currentMode(), 'manual');
  assert.deepEqual(counts(appDatabase()), { jobs: 0, entries: 0 }, 'Manual mode shows none of them');

  const real = new DatabaseSync(databasePath(), { readOnly: true });
  try {
    const urls = real.prepare('SELECT url FROM opportunity').all().map((r) => r.url);
    const projects = real.prepare('SELECT project FROM portfolio_evidence').all().map((r) => r.project);
    for (const j of DEMO_JOBS) assert.ok(!urls.includes(j.url), `${j.url} is not in the real database`);
    for (const e of DEMO_PORTFOLIO) assert.ok(!projects.includes(e.project), `${e.project} is not in the real database`);
    assert.equal(real.prepare('SELECT COUNT(*) AS n FROM preferences').get().n, 0, 'no demo preferences either');
  } finally {
    real.close();
  }
}));

test('the loader throws when handed the real database, or any other, and writes nothing', withDataDir(async () => {
  const real = openDatabase(databasePath());
  const memory = openDatabase(':memory:');
  runMigrations(memory);
  try {
    for (const db of [real, memory]) {
      assert.throws(() => loadDemoData(db), /refusing to write demo data/);
      assert.throws(() => reloadDemoData(db), /refusing to write demo data/);
      assert.throws(() => emptyDemoDatabase(db), /refusing to write demo data/);
      assert.deepEqual(counts(db), { jobs: 0, entries: 0 });
    }
  } finally {
    real.close();
    memory.close();
  }
}));

test('Reload demo data empties the demo database and loads the made-up data again', withDataDir(async () => {
  await postMode(modeForm('demo'));
  const db = appDatabase();
  // Dane's own clicks in Demo: a job of his, a proposal with a saved version (a table that refuses deletes).
  const extra = saveJob(db, { url: 'https://www.upwork.com/jobs/~01demo0000000extra', title: 'A demo job of his own', description: 'Made up.', budget: null, jobType: null, postedAt: null, client: null, connectsCost: null });
  const proposal = db.prepare("INSERT INTO proposal (opportunity_id, draft) VALUES (?, 'Made-up draft.')").run(extra.id).lastInsertRowid;
  db.prepare("INSERT INTO proposal_version (proposal_id, version_no, draft, answers, change, author) VALUES (?, 2, 'Made-up draft.', '[]', 'draft', 'Dane')").run(proposal);
  assert.equal(listJobs(db).length, DEMO_JOBS.length + 1);

  const res = await postDemo();
  assert.equal(res.headers.get('location'), '/jobs?demo=loaded');
  assert.deepEqual(listJobs(db).map((j) => j.title).sort(), DEMO_JOBS.map((j) => j.title).sort(), 'back to just the made-up jobs');
  assert.equal(listEntries(db).length, DEMO_PORTFOLIO.length);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM proposal_version').get().n, 0);
  assert.equal(buildInbox(db).top[0].job.title, 'Made-up sales dashboard for a bakery chain');

  // The safety rules are back: a saved version still can never be deleted.
  const again = db.prepare("INSERT INTO proposal (opportunity_id, draft) VALUES (?, 'x')").run(listJobs(db)[0].id).lastInsertRowid;
  db.prepare("INSERT INTO proposal_version (proposal_id, version_no, draft, answers, change, author) VALUES (?, 2, 'x', '[]', 'draft', 'Dane')").run(again);
  assert.throws(() => db.prepare('DELETE FROM proposal_version').run(), /can never be deleted/);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys are back on');
  assert.deepEqual(calls, []);
}));

test('Reload does nothing outside Demo mode', withDataDir(async () => {
  setMode('manual');
  const res = await postDemo();
  assert.equal(res.headers.get('location'), '/jobs');
  assert.deepEqual(counts(appDatabase()), { jobs: 0, entries: 0 });
}));

test('the Demo banner offers Reload demo data to a signed-in browser only', () => {
  const demo = renderToStaticMarkup(createElement(ModeBar, { mode: 'demo' }));
  assert.match(demo, /action="\/api\/demo"/);
  assert.ok(demo.includes(RELOAD_LABEL));
  assert.ok(!renderToStaticMarkup(createElement(ModeBar, { mode: 'demo', canSwitch: false })).includes(RELOAD_LABEL));
  assert.ok(!renderToStaticMarkup(createElement(ModeBar, { mode: 'manual' })).includes(RELOAD_LABEL));
});
