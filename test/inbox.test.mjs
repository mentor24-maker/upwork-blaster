import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '../lib/db.ts';
import { saveJob } from '../lib/jobs.ts';
import { gate } from '../lib/gate.ts';
import { currentPreferences, DEFAULT_SETTINGS, listPreferenceVersions, savePreferences } from '../lib/preferences.ts';
import { addEntry } from '../lib/portfolio.ts';
import { latestEvaluations, scoreJob } from '../lib/score.ts';
import {
  buildInbox,
  decisionHistory,
  latestDecision,
  needOf,
  readDecisionForm,
  recordDecision,
  TOP_COUNT,
} from '../lib/inbox.ts';
import { POST as postDecision } from '../app/api/decisions/route.ts';

// Made-up jobs and preferences for the tests only: no real client text.
const SETTINGS = {
  ...DEFAULT_SETTINGS,
  themes: ['Dashboards', 'Custom web applications'],
  requiredTech: ['Next.js', 'TypeScript'],
  unsupportedTech: ['WordPress'],
  exclusions: [],
};

const freshDb = () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  savePreferences(db, SETTINGS);
  return db;
};

let n = 0;
const addJob = (db, over = {}) => {
  n++;
  const saved = saveJob(db, {
    url: `https://example.test/job/${n}`,
    title: `Made-up job ${n}`,
    description: 'Fix a typo.',
    budget: null,
    jobType: null,
    postedAt: null,
    client: null,
    connectsCost: null,
    ...over,
  });
  assert.ok(saved.ok);
  scoreJob(db, saved.id);
  return saved.id;
};

const STRONG =
  'We need a custom web application: a sales dashboard in Next.js and TypeScript.\n' +
  '- Login for five users\n- Charts of weekly sales\n- Export to CSV\nDeliverables: the app and its source.';

const ids = (cards) => cards.map((c) => c.job.id);

test('the inbox ranks jobs highest score first, shows five, and keeps the rest under more', () => {
  const db = freshDb();
  const weak = [];
  for (let i = 0; i < 5; i++) weak.push(addJob(db));
  const strong = addJob(db, { title: 'Sales dashboard', description: STRONG, budget: '$4,000', jobType: 'fixed' });

  const inbox = buildInbox(db);
  assert.equal(inbox.top.length, TOP_COUNT);
  assert.equal(inbox.top[0].job.id, strong, 'the best fit is first');
  assert.equal(inbox.top[0].rank, 1);
  assert.deepEqual(inbox.top.map((c) => c.rank), [1, 2, 3, 4, 5]);
  assert.equal(inbox.more.length, 1);
  assert.equal(inbox.more[0].rank, 6);
  for (let i = 1; i < inbox.top.length; i++) assert.ok(inbox.top[i - 1].score >= inbox.top[i].score);
});

test('a card shows unknown facts as unknown, never guessed', () => {
  const db = freshDb();
  const id = addJob(db, { description: 'Fix a typo on our site.' });
  const [c] = buildInbox(db).top;
  assert.equal(c.job.id, id);
  assert.equal(c.job.budget, null);
  assert.equal(c.job.connectsCost, null);
  assert.equal(c.humanInvolvement, null, 'not estimated yet, so unknown');
  assert.ok(c.principalUncertainty, 'the biggest unknown is named');
  assert.equal(c.portfolioEvidence, null, 'no approved project matched');
  assert.equal(c.reasons.length, 5, 'all five parts of the score are shown');
  assert.equal(c.need, 'Fix a typo on our site.');
});

test('a card names the approved portfolio project that matched', () => {
  const db = freshDb();
  addEntry(db, { project: 'Ledger Lite', status: 'delivered', features: 'sales dashboard', links: [], approvedForUse: true });
  addJob(db, { description: STRONG });
  const [c] = buildInbox(db).top;
  assert.match(c.portfolioEvidence, /Ledger Lite/);
});

test('each decision is recorded, and passing changes neither the preferences nor the score', () => {
  const db = freshDb();
  const a = addJob(db, { description: STRONG });
  const b = addJob(db);
  const before = {
    prefs: listPreferenceVersions(db),
    evals: latestEvaluations(db),
    evalRows: db.prepare('SELECT COUNT(*) AS n FROM evaluation').get().n,
  };

  const pursued = recordDecision(db, a, 'pursue');
  assert.equal(pursued.decision, 'pursue');
  assert.equal(pursued.reason, null);
  const revisit = recordDecision(db, b, 'revisit', '  maybe   next week ');
  assert.equal(revisit.reason, 'maybe next week', 'the reason is tidied');
  const passed = recordDecision(db, a, 'pass', 'Too small for now');
  assert.equal(passed.decision, 'pass');

  assert.deepEqual(decisionHistory(db, a).map((d) => d.decision), ['pursue', 'pass'], 'history is kept');
  assert.equal(latestDecision(db, a).decision, 'pass', 'the newest is in force');
  assert.equal(latestDecision(db, b).decision, 'revisit');

  assert.deepEqual(listPreferenceVersions(db), before.prefs, 'passing never changes his preferences');
  assert.deepEqual(currentPreferences(db).settings, SETTINGS);
  assert.deepEqual(latestEvaluations(db), before.evals, 'nor any score');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM evaluation').get().n, before.evalRows);

  assert.equal(recordDecision(db, 9999, 'pass'), undefined, 'no such job: nothing saved');
  assert.throws(() => recordDecision(db, a, 'delete'));
});

test('a passed job leaves the inbox but stays findable, and Revisit brings it back', () => {
  const db = freshDb();
  const a = addJob(db, { description: STRONG });
  const b = addJob(db);
  recordDecision(db, a, 'pass', 'not now');

  let inbox = buildInbox(db);
  assert.deepEqual(ids(inbox.top), [b], 'it left the inbox, and the next job moves up to rank 1');
  assert.equal(inbox.top[0].rank, 1);
  assert.deepEqual(ids(inbox.passed), [a], 'and is still findable');
  assert.equal(inbox.passed[0].decision.reason, 'not now');

  recordDecision(db, a, 'revisit');
  inbox = buildInbox(db);
  assert.deepEqual(ids(inbox.top), [a, b]);
  assert.equal(inbox.top[0].decision.decision, 'revisit');
  assert.deepEqual(inbox.passed, []);
});

test('excluded jobs are listed apart with their reason, not ranked', () => {
  const db = freshDb();
  const ok = addJob(db);
  const wp = addJob(db, { description: STRONG + '\nBuilt on WordPress.' });

  const inbox = buildInbox(db);
  assert.deepEqual(ids([...inbox.top, ...inbox.more]), [ok], 'the excluded job is not ranked');
  assert.deepEqual(ids(inbox.excluded), [wp]);
  assert.equal(inbox.excluded[0].rank, null);
  assert.equal(inbox.excluded[0].score, null);
  assert.deepEqual(inbox.excluded[0].exclusions.map((e) => e.rule), ['WordPress'], 'with the exclusion it met');
});

test('a job that was never scored is listed apart, not ranked', () => {
  const db = freshDb();
  const saved = saveJob(db, { url: 'https://example.test/unscored', title: 'Unscored', description: 'x', budget: null, jobType: null, postedAt: null, client: null, connectsCost: null });
  const inbox = buildInbox(db);
  assert.deepEqual(ids(inbox.notScored), [saved.id]);
  assert.deepEqual(inbox.top, []);
});

test('the need is the post’s first sentence, cut to a card’s length', () => {
  assert.equal(needOf('We need a dashboard. It has charts.'), 'We need a dashboard.');
  assert.equal(needOf('  no full stop here  '), 'no full stop here');
  const long = needOf('a'.repeat(500));
  assert.equal(long.length, 220);
  assert.ok(long.endsWith('…'));
});

test('the decision form accepts only a job id and one of the three decisions', () => {
  const form = (obj) => ({ get: (k) => obj[k] ?? null });
  assert.deepEqual(readDecisionForm(form({ id: '3', decision: 'pass', reason: 'meh' })), { opportunityId: 3, decision: 'pass', reason: 'meh' });
  assert.equal(readDecisionForm(form({ id: '3', decision: 'archive' })), null);
  assert.equal(readDecisionForm(form({ id: 'x', decision: 'pass' })), null);
  assert.equal(readDecisionForm(form({ decision: 'pass' })), null);
});

test('the buttons’ form post records the decision and nothing else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-inbox-test-'));
  const saved = process.env.UB_DATA_DIR;
  process.env.UB_DATA_DIR = dir;
  try {
    const setup = openDatabase(join(dir, 'app.sqlite'));
    runMigrations(setup);
    savePreferences(setup, SETTINGS);
    const id = addJob(setup, { description: STRONG });
    setup.close();

    const post = (obj) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(obj)) body.set(k, v);
      return postDecision(new Request('http://mac-mini.local:4280/api/decisions', { method: 'POST', body }));
    };
    const res = await post({ id: String(id), decision: 'pass', reason: 'Too small' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/inbox\?decided=\d+$/);

    assert.equal((await post({ id: String(id), decision: 'nope' })).headers.get('location'), '/inbox?error=bad-decision');
    assert.equal((await post({ id: '9999', decision: 'pass' })).headers.get('location'), '/inbox?error=not-found');

    const db = openDatabase(join(dir, 'app.sqlite'));
    assert.deepEqual(decisionHistory(db, id).map((d) => [d.decision, d.reason]), [['pass', 'Too small']]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM preferences').get().n, 1, 'preferences untouched');
    db.close();
  } finally {
    if (saved === undefined) delete process.env.UB_DATA_DIR;
    else process.env.UB_DATA_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Inbox page and its form post are behind the password', () => {
  const ENV = { APP_PASSWORD: 'test-only-password', APP_SESSION_SECRET: 'test-only-session-secret' };
  const page = gate(new Request('http://mac-mini.local:4280/inbox'), ENV);
  assert.equal(page?.status, 307);
  const body = new FormData();
  body.set('id', '1');
  body.set('decision', 'pass');
  const post = gate(new Request('http://mac-mini.local:4280/api/decisions', { method: 'POST', body }), ENV);
  assert.equal(post?.status, 401, 'a signed-out form post gets nothing');
});
