// "Export my data" (task 4.6): one JSON file with every list of Dane's data,
// nothing for a signed-out visitor, and never a secret. Every job here is
// made up; no test calls the real AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationFiles, openDatabase, REPO_DIR, runMigrations } from '../lib/db.ts';
import { saveJob } from '../lib/jobs.ts';
import { DEFAULT_SETTINGS, savePreferences } from '../lib/preferences.ts';
import { addEntry } from '../lib/portfolio.ts';
import { scoreJob } from '../lib/score.ts';
import { recordDecision } from '../lib/inbox.ts';
import { answerQuestion, DRAFT_MODEL, getProposal, openProposal } from '../lib/draft.ts';
import { approve, fingerprintOf } from '../lib/approval.ts';
import { markSent } from '../lib/sent.ts';
import { addNote, moveJob, setNextAction } from '../lib/pipeline.ts';
import { buildExport, EXPORT_LISTS, exportFileName, mountainTimestamp } from '../lib/export.ts';
import { gate } from '../lib/gate.ts';
import { createSessionToken, SESSION_COOKIE } from '../lib/session.ts';
import { GET as getExport } from '../app/api/export/route.ts';

const FAKE_AI_KEY = 'sk-ant-made-up-export-test-key-7777';
const FAKE_PASSWORD = 'made-up-export-test-password';
const FAKE_SECRET = 'made-up-export-test-secret-for-signing-cookies';
const DRAFT = 'Hello, I would build your sales dashboard in Next.js and keep you posted every week.';

function fakeModel(text) {
  return {
    getKey: () => FAKE_AI_KEY,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ model: DRAFT_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 250 } }),
        { status: 200 },
      ),
  };
}

/** A database holding one row of every list (and two preferences versions). */
async function fullDb(path = ':memory:') {
  const db = openDatabase(path);
  runMigrations(db);
  savePreferences(db, { ...DEFAULT_SETTINGS, themes: ['Dashboards'], requiredTech: ['Next.js'], exclusions: [] });
  savePreferences(db, { ...DEFAULT_SETTINGS, themes: ['Dashboards', 'Reports'], requiredTech: ['Next.js'], exclusions: [] });
  addEntry(db, { project: 'Made-up sales dashboard', status: 'delivered', features: 'Charts and exports', links: ['https://example.com/demo'], approvedForUse: true });
  const saved = saveJob(db, {
    url: 'https://www.upwork.com/jobs/~01export000001',
    title: 'Made-up export job',
    description: 'We need a sales dashboard in Next.js.\n\nScreening questions:\n1. How soon can you start?',
    budget: '$2,000',
    jobType: 'fixed',
    postedAt: null,
    client: null,
    connectsCost: null,
  });
  assert.ok(saved.ok);
  assert.ok(scoreJob(db, saved.id), 'scored');
  assert.ok(recordDecision(db, saved.id, 'pursue', 'Fits the dashboards theme.'));
  const opened = await openProposal(db, saved.id, fakeModel(DRAFT));
  for (const q of opened.questions) assert.ok(answerQuestion(db, opened.id, q.id, 'Next Monday.'));
  const p = getProposal(db, opened.id);
  assert.equal(approve(db, p.id, fingerprintOf(p)).ok, true);
  assert.equal(markSent(db, p.id, fingerprintOf(getProposal(db, p.id))).ok, true);
  assert.equal(moveJob(db, p.id, 'replied').ok, true);
  assert.equal(addNote(db, p.id, 'They asked for a call.').ok, true);
  assert.equal(setNextAction(db, p.id, 'Call Tuesday 10am').ok, true);
  return { db, jobId: saved.id, proposalId: p.id };
}

test('the file has one list per kind of data, each holding its row, and both preferences versions', async () => {
  const { db, jobId, proposalId } = await fullDb();
  const out = buildExport(db, new Date('2026-11-27T17:52:03Z'));
  assert.deepEqual(Object.keys(out), ['about', ...EXPORT_LISTS.map(([name]) => name)]);
  assert.deepEqual(out.about, {
    app: 'Upwork Blaster',
    exportedAt: '2026-11-27T10:52:03-07:00',
    databaseVersion: Number.parseInt(migrationFiles().at(-1), 10),
    databaseMigration: migrationFiles().at(-1),
  });
  for (const [name, table] of EXPORT_LISTS) {
    const count = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    assert.equal(out[name].length, count, `${name}: every row of ${table}`);
    assert.ok(count >= 1, `${name}: the test database holds a row`);
  }
  assert.equal(out.jobs[0].id, jobId);
  assert.equal(out.jobs[0].title, 'Made-up export job');
  assert.equal(out.decisions[0].reason, 'Fits the dashboards theme.');
  assert.equal(out.proposals[0].id, proposalId);
  assert.equal(out.proposals[0].draft, DRAFT);
  assert.equal(out.proposalQuestions[0].answer, 'Next Monday.');
  assert.equal(out.approvals[0].proposal_id, proposalId);
  assert.equal(out.sentRecords[0].proposal_id, proposalId);
  assert.deepEqual(out.pipelineMoves.map((m) => m.status), ['replied']);
  assert.deepEqual(out.pipelineNotes.map((m) => m.note), ['They asked for a call.']);
  assert.equal(out.pipelineNextActions[0].next_action, 'Call Tuesday 10am');

  assert.deepEqual(out.preferences.map((p) => p.version), [1, 2], 'every saved version, not only the newest');
  assert.deepEqual(out.preferences.map((p) => p.settings.themes), [['Dashboards'], ['Dashboards', 'Reports']]);
});

test('columns kept as JSON text come out as JSON, not as a string inside a string', async () => {
  const { db } = await fullDb();
  const out = buildExport(db);
  assert.equal(typeof out.preferences[0].settings, 'object');
  assert.deepEqual(out.portfolioEvidence[0].links, ['https://example.com/demo']);
  assert.ok(Array.isArray(out.evaluations[0].flags));
  assert.equal(typeof out.evaluations[0].dimensions, 'object');
  assert.ok(Array.isArray(out.proposals[0].evidence_ids));
  assert.equal(typeof out.approvals[0].approved_answers, 'object');
  assert.doesNotMatch(JSON.stringify(out), /"[{[]\\"/, 'no JSON nested in a string');
});

test('the AI spending log and the migration bookkeeping are not in the file', async () => {
  const { db } = await fullDb();
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM ai_usage').get().c >= 1, 'the draft did log AI use');
  const text = JSON.stringify(buildExport(db));
  assert.ok(!EXPORT_LISTS.some(([, table]) => table === 'ai_usage' || table === 'schema_migrations'));
  assert.doesNotMatch(text, /input_tokens|001_first_tables\.sql/);
});

test('the file is dated in Mountain time', () => {
  // 03:00 UTC on the 28th is still the evening of the 27th in Denver.
  assert.equal(exportFileName(new Date('2026-11-28T03:00:00Z')), 'upwork-blaster-export-2026-11-27.json');
  assert.equal(mountainTimestamp(new Date('2026-07-04T18:00:00Z')), '2026-07-04T12:00:00-06:00', 'daylight time');
});

test('signed out gets nothing (an empty redirect from the gate, an empty 401 from the route); signed in gets the file, with no secret in it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-export-test-'));
  const keys = ['UB_DATA_DIR', 'APP_PASSWORD', 'APP_SESSION_SECRET', 'ANTHROPIC_API_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.UB_DATA_DIR = dir;
  process.env.APP_PASSWORD = FAKE_PASSWORD;
  process.env.APP_SESSION_SECRET = FAKE_SECRET;
  process.env.ANTHROPIC_API_KEY = FAKE_AI_KEY;
  try {
    const { db } = await fullDb(join(dir, 'app.sqlite'));
    db.close();
    const request = (cookie) => new Request('http://mac-mini.local:4280/api/export', { headers: cookie ? { cookie } : {} });

    for (const [why, cookie] of [['no cookie', undefined], ['a forged cookie', `${SESSION_COOKIE}=1.forged`]]) {
      const fromGate = gate(request(cookie));
      assert.equal(fromGate?.status, 307, `${why}: the gate sends a page visit to the sign-in page`);
      assert.equal(await fromGate.text(), '', `${why}: with nothing in the body`);
      const fromRoute = getExport(request(cookie));
      assert.equal(fromRoute.status, 401, `${why}: the route itself refuses`);
      assert.equal(await fromRoute.text(), '', `${why}: with an empty body`);
      assert.equal(fromRoute.headers.get('content-disposition'), null, `${why}: and no file`);
    }
    // An API caller (not a page visit) gets the gate's 401.
    const post = new Request('http://mac-mini.local:4280/api/export', { method: 'POST' });
    assert.equal(gate(post)?.status, 401);
    assert.equal(await gate(post).text(), '');

    const token = createSessionToken({ password: FAKE_PASSWORD, secret: FAKE_SECRET });
    const cookie = `${SESSION_COOKIE}=${token}`;
    assert.equal(gate(request(cookie)), undefined, 'the gate lets a signed-in visit through');
    const res = getExport(request(cookie));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="upwork-blaster-export-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = await res.text();
    const out = JSON.parse(text);
    assert.equal(out.jobs.length, 1);
    assert.equal(out.preferences.length, 2);
    for (const secret of [FAKE_PASSWORD, FAKE_SECRET, FAKE_AI_KEY, token, token.split('.')[1]]) {
      assert.ok(!text.includes(secret), 'no password, cookie key, AI key or session cookie in the file');
    }
  } finally {
    for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the home page links to the export', () => {
  const page = readFileSync(join(REPO_DIR, 'app/page.tsx'), 'utf8');
  assert.match(page, /<a href="\/api\/export">Export my data<\/a>/);
});
