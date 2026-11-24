import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '../lib/db.ts';
import { jobFormMessage, listJobs, normaliseJobUrl, readJobForm, saveJob } from '../lib/jobs.ts';
import { gate } from '../lib/gate.ts';
import { POST as postJob } from '../app/api/jobs/route.ts';
import { useAiDepsForTests } from '../lib/extractJob.ts';

// Saving a job now asks the AI to read it (task 2.4). These tests are about
// the form, so the AI is switched off: no key, and nothing is ever sent.
useAiDepsForTests({ getKey: () => '', fetchImpl: async () => { throw new Error('no test calls the real API'); } });

// Made-up job posts for the tests only: no real client's text goes here.
const fields = (over = {}) => ({
  url: 'https://www.upwork.com/jobs/Build-a-made-up-dashboard_~01aaaabbbbccccdddd/?referrer_url_path=x',
  title: 'Build a made-up dashboard',
  description: 'Made-up text for the test: a small dashboard.',
  budget: '$1,500',
  job_type: 'fixed',
  posted_at: '2 hours ago',
  client: 'Payment verified (made up)',
  connects_cost: '16',
  ...over,
});
const asForm = (obj) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
};
const freshDb = () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
};

test('the same Upwork job is recognised however its link is written', () => {
  const id = 'https://www.upwork.com/jobs/~01aaaabbbbccccdddd';
  for (const link of [
    'https://www.upwork.com/jobs/~01aaaabbbbccccdddd',
    '  https://www.upwork.com/jobs/~01AAAABBBBCCCCDDDD  ',
    'https://www.upwork.com/jobs/Build-a-made-up-dashboard_~01aaaabbbbccccdddd/',
    'https://upwork.com/jobs/~01aaaabbbbccccdddd?referrer_url_path=%2Fnx%2Fsearch',
    'https://www.upwork.com/nx/search/jobs/details/~01aaaabbbbccccdddd?pageTitle=Job',
    'https://www.upwork.com/freelance-jobs/apply/Made-up_~01aaaabbbbccccdddd/#apply',
  ]) {
    assert.equal(normaliseJobUrl(link), id, link);
  }
  assert.equal(normaliseJobUrl('https://Example.com/a/b/?x=1#y'), 'https://example.com/a/b');
  for (const bad of ['', 'not a link', 'ftp://www.upwork.com/jobs/~01aaaabbbbcccc', 'javascript:alert(1)']) {
    assert.equal(normaliseJobUrl(bad), null, bad);
  }
});

test('a job is saved and reads back, with blank fields kept as unknown', () => {
  const db = freshDb();
  const read = readJobForm(asForm(fields({ budget: '  ', job_type: '', posted_at: '', client: '', connects_cost: '' })));
  assert.ok(read.ok);
  const saved = saveJob(db, read.job);
  assert.ok(saved.ok);
  const [job] = listJobs(db);
  assert.equal(job.id, saved.id);
  assert.equal(job.url, 'https://www.upwork.com/jobs/~01aaaabbbbccccdddd');
  assert.equal(job.title, 'Build a made-up dashboard');
  assert.equal(job.description, 'Made-up text for the test: a small dashboard.');
  assert.deepEqual(
    { budget: job.budget, jobType: job.jobType, postedAt: job.postedAt, client: job.client, connectsCost: job.connectsCost },
    { budget: null, jobType: null, postedAt: null, client: null, connectsCost: null },
  );

  const full = readJobForm(asForm(fields({ url: 'https://www.upwork.com/jobs/~01eeeeffff00001111' })));
  assert.ok(full.ok && saveJob(db, full.job).ok);
  const newest = listJobs(db)[0];
  assert.equal(newest.url, 'https://www.upwork.com/jobs/~01eeeeffff00001111', 'newest first');
  assert.deepEqual(
    { budget: newest.budget, jobType: newest.jobType, postedAt: newest.postedAt, client: newest.client, connectsCost: newest.connectsCost },
    { budget: '$1,500', jobType: 'fixed', postedAt: '2 hours ago', client: 'Payment verified (made up)', connectsCost: 16 },
  );
  db.close();
});

test('a second job with the same link is refused and nothing changes', () => {
  const db = freshDb();
  const first = saveJob(db, readJobForm(asForm(fields())).job);
  assert.ok(first.ok);
  const again = readJobForm(asForm(fields({ url: 'https://www.upwork.com/jobs/~01AAAABBBBCCCCDDDD?ref=other', title: 'Another title' })));
  assert.deepEqual(saveJob(db, again.job), { ok: false, error: 'duplicate', existingId: first.id });
  assert.equal(listJobs(db).length, 1);
  assert.equal(listJobs(db)[0].title, 'Build a made-up dashboard', 'the first save is untouched');
  assert.match(jobFormMessage('duplicate'), /already saved/);
  db.close();
});

test('the form refuses what it should, each with a plain message', () => {
  const cases = [
    [{ url: '' }, 'no-url'],
    [{ url: 'upwork job' }, 'bad-url'],
    [{ title: ' ' }, 'no-title'],
    [{ description: '' }, 'no-description'],
    [{ description: 'x'.repeat(50_001) }, 'too-long'],
    [{ budget: 'x'.repeat(2_001) }, 'too-long'],
    [{ job_type: 'monthly' }, 'bad-job-type'],
    [{ connects_cost: '-1' }, 'bad-connects'],
    [{ connects_cost: '2.5' }, 'bad-connects'],
  ];
  for (const [over, error] of cases) {
    assert.deepEqual(readJobForm(asForm(fields(over))), { ok: false, error }, JSON.stringify(over).slice(0, 60));
    assert.ok(jobFormMessage(error), `${error} has a message`);
  }
  assert.equal(jobFormMessage('<script>'), null, 'only its own messages, whatever the address says');
  assert.equal(jobFormMessage(undefined), null);
});

test('the database itself refuses a bad job type or Connects count', () => {
  const db = freshDb();
  const add = db.prepare("INSERT INTO opportunity (url, title, description, job_type, connects_cost) VALUES (?, 't', 'd', ?, ?)");
  assert.throws(() => add.run('https://x/1', 'monthly', null), /CHECK/);
  assert.throws(() => add.run('https://x/2', null, -1), /CHECK/);
  add.run('https://x/3', 'hourly', 0);
  db.close();
});

test('the form post saves a job, then refuses the same link with a message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-jobs-test-'));
  const saved = process.env.UB_DATA_DIR;
  process.env.UB_DATA_DIR = dir;
  try {
    const setup = openDatabase(join(dir, 'app.sqlite'));
    runMigrations(setup); // what scripts/run_app.sh does before the app starts
    setup.close();
    const post = (obj) => postJob(new Request('http://mac-mini.local:4280/api/jobs', { method: 'POST', body: asForm(obj) }));

    const first = await post(fields());
    assert.equal(first.status, 303);
    assert.match(first.headers.get('location'), /^\/jobs\?saved=\d+$/);

    const dup = await post(fields({ url: 'https://www.upwork.com/jobs/~01aaaabbbbccccdddd' }));
    assert.equal(dup.status, 303);
    assert.match(dup.headers.get('location'), /^\/jobs\/new\?error=duplicate&existing=\d+$/);

    const bad = await post(fields({ title: '' }));
    assert.equal(bad.headers.get('location'), '/jobs/new?error=no-title');

    // It really is on disk, in the data folder.
    const db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM opportunity').get().n, 1);
    db.close();
  } finally {
    if (saved === undefined) delete process.env.UB_DATA_DIR;
    else process.env.UB_DATA_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the job pages and the form post are behind the password', async () => {
  const ENV = { APP_PASSWORD: 'test-only-password', APP_SESSION_SECRET: 'test-only-session-secret' };
  for (const path of ['/jobs', '/jobs/new', '/jobs?saved=1']) {
    const res = gate(new Request(`http://mac-mini.local:4280${path}`), ENV);
    assert.equal(res?.status, 307, path);
    assert.equal(res.headers.get('location'), 'http://mac-mini.local:4280/sign-in');
  }
  const post = gate(new Request('http://mac-mini.local:4280/api/jobs', { method: 'POST', body: asForm(fields()) }), ENV);
  assert.equal(post?.status, 401, 'a signed-out form post gets nothing');
  const action = gate(new Request('http://mac-mini.local:4280/jobs/new', { method: 'POST', headers: { 'next-action': 'x' } }), ENV);
  assert.equal(action?.status, 401, 'nor does a server action on the job pages');
});
