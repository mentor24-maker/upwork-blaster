// The claim check (task 3.2, hand-off §5C and §13.5): a draft that presents
// unfinished work as delivered, cites unapproved work, or uses a number with
// no source gets a blocking flag, and a flagged draft cannot be approved.
// Every job and project here is made up; no test calls the real API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '../lib/db.ts';
import { saveJob } from '../lib/jobs.ts';
import { DEFAULT_SETTINGS, savePreferences } from '../lib/preferences.ts';
import { addEntry, getEntry, updateEntry } from '../lib/portfolio.ts';
import { answerQuestion, DRAFT_MODEL, getProposal, openProposal, readWorkspaceForm, saveDraft, useDraftDepsForTests } from '../lib/draft.ts';
import { approvalBlock, checkClaims, numbersIn, proposalFlags, sentencesOf } from '../lib/claimCheck.ts';
import { POST as postWorkspace } from '../app/api/proposals/route.ts';

const DELIVERED = { project: 'Clinic Dashboard', status: 'delivered', features: 'weekly charts for 12 clinics', links: ['https://example.test/clinic'], approvedForUse: true };
const PLANNED = { project: 'Booking Helper', status: 'planned', features: 'calendar sync', links: [], approvedForUse: true };
const IN_PROGRESS = { project: 'Invoice Robot', status: 'in progress', features: 'reads invoices', links: [], approvedForUse: true };
const UNAPPROVED = { project: 'Quiet Client Portal', status: 'delivered', features: 'revenue up 300%', links: [], approvedForUse: false };

const POST_TEXT = 'We need a sales dashboard in Next.js for our team of 25 people.\n\nScreening questions:\n1. How soon can you start?';

let seq = 0;
const entry = (e) => ({ ...e, id: ++seq, createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z' });
const SOURCES = {
  entries: [entry(DELIVERED), entry(PLANNED), entry(IN_PROGRESS), entry(UNAPPROVED)],
  jobTexts: ['Made-up dashboard job', POST_TEXT, '$2,000', ''],
};
const kinds = (text, sources = SOURCES) => checkClaims(text, sources).map((f) => f.kind);

function fakeModel(text) {
  return {
    getKey: () => 'sk-ant-fake-test-key-4444',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ model: DRAFT_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 250 } }),
        { status: 200 },
      ),
  };
}

function freshDb(path = ':memory:') {
  const db = openDatabase(path);
  runMigrations(db);
  savePreferences(db, { ...DEFAULT_SETTINGS, themes: ['Dashboards'], requiredTech: ['Next.js'], exclusions: [] });
  return db;
}

let n = 0;
function addJob(db) {
  n++;
  const saved = saveJob(db, {
    url: `https://www.upwork.com/jobs/~01claim${String(n).padStart(6, '0')}`,
    title: `Made-up dashboard job ${n}`,
    description: POST_TEXT,
    budget: '$2,000',
    jobType: 'fixed',
    postedAt: null,
    client: null,
    connectsCost: null,
  });
  assert.ok(saved.ok);
  return saved.id;
}

// ── the three kinds, one at a time ────────────────────────────────────────

test('a planned project presented as delivered raises its flag, naming the sentence and why', () => {
  const flags = checkClaims('Hello there. I delivered Booking Helper last spring. Happy to talk.', SOURCES);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, 'planned-as-delivered');
  assert.equal(flags[0].sentence, 'I delivered Booking Helper last spring.');
  assert.match(flags[0].why, /“Booking Helper” is marked planned/);
  assert.match(flags[0].why, /presents it as finished/);
});

test('an in-progress project counts as unfinished too, and so does a bare mention that does not say so', () => {
  assert.deepEqual(kinds('I built the invoice robot for a client.'), ['planned-as-delivered'], 'any case, any spacing');
  const bare = checkClaims('Booking Helper syncs calendars for busy teams.', SOURCES);
  assert.deepEqual(bare.map((f) => f.kind), ['planned-as-delivered']);
  assert.match(bare[0].why, /does not say it is unfinished/);
});

test('saying plainly that the work is unfinished is honest, and is not flagged', () => {
  assert.deepEqual(kinds('I am currently building Booking Helper, which will sync calendars.'), []);
  assert.deepEqual(kinds('Invoice Robot is in progress: it reads invoices today in testing.'), []);
  assert.deepEqual(kinds('Booking Helper is planned, but I already launched it.'), ['planned-as-delivered'], 'a "done" word still wins');
});

test('work not approved for use raises its flag, however it is worded', () => {
  const flags = checkClaims('My Quiet Client Portal is a good example of this.', SOURCES);
  assert.deepEqual(flags.map((f) => f.kind), ['unapproved-evidence']);
  assert.match(flags[0].why, /not approved for use/);
});

test('a number with no source raises its flag; one from the post or an approved entry does not', () => {
  const flags = checkClaims('I have 7 years of dashboard work and cut load times 40%.', SOURCES);
  assert.deepEqual(flags.map((f) => f.kind), ['invented-number']);
  assert.match(flags[0].why, /The numbers 7, 40 appear nowhere/);
  assert.deepEqual(kinds('For your team of 25, within the $2000 budget, like Clinic Dashboard for 12 clinics.'), [], 'all three are sourced');
  assert.deepEqual(kinds('Revenue went up 300% for a client.'), ['invented-number'], 'an unapproved entry is no source');
  assert.deepEqual(kinds('Built on Next.js with S3, Web3 wallets and 3D charts: see https://example.test/a/2024/99.'), [], 'names and links are not figures');
});

test('review round 1: numbers with a unit glued on are numbers, and decimals stay whole', () => {
  assert.deepEqual(numbersIn('10x faster over 8yrs, 3hrs, 50ms, 2 days, 10+ and 1.5x'), ['10', '8', '3', '50', '2', '10', '1.5']);
  assert.deepEqual(numbersIn('5m and 5M and 2bn'), ['5000000', '5000000', '2000000000']);
  assert.deepEqual(kinds('I made dashboards 10x faster over 8yrs.'), ['invented-number']);
  assert.match(checkClaims('I made dashboards 10x faster over 8yrs.', SOURCES)[0].why, /The numbers 10, 8 appear nowhere/);
  assert.deepEqual(kinds('Speeds went up 1.5x.'), ['invented-number'], 'not read as a bare 1 sourced by the "1." question');
  assert.deepEqual(kinds('Load times dropped 50ms.'), ['invented-number']);
});

test('review round 1: a not-yet phrase wins over the done word inside it', () => {
  assert.deepEqual(kinds('Booking Helper is being built now.'), []);
  assert.deepEqual(kinds('Booking Helper is not yet launched.'), []);
  assert.deepEqual(kinds('Booking Helper is not yet in production.'), []);
  assert.deepEqual(kinds("Invoice Robot hasn't been deployed yet."), []);
  assert.deepEqual(kinds('Booking Helper will be launched in spring.'), []);
  assert.deepEqual(kinds('Booking Helper is being built, and I launched it last week.'), ['planned-as-delivered'], 'a real done word still counts');
});

test('review round 1: contractions say "building" as well as the words written out', () => {
  assert.deepEqual(kinds("I'm building Booking Helper for this."), []);
  assert.deepEqual(kinds('We’re developing Invoice Robot now.'), [], 'curly apostrophe too');
  assert.deepEqual(kinds("It's being built: Booking Helper syncs calendars."), []);
});

test('review round 1: done and not-yet words are judged in the clause about each project', () => {
  assert.deepEqual(kinds('I delivered Clinic Dashboard and am currently building Booking Helper.'), []);
  assert.deepEqual(kinds("Booking Helper, which I'm building now, syncs calendars."), []);
  assert.deepEqual(kinds('I delivered Booking Helper and Clinic Dashboard.'), ['planned-as-delivered']);
  assert.deepEqual(kinds('I am building Booking Helper; Invoice Robot handles invoices.'), ['planned-as-delivered'], 'each project needs its own honest clause');
});

test("Dane's own screening answers are a source for numbers", async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel('I can start in 2 days.'));
  assert.deepEqual(proposalFlags(db, p.id).map((f) => f.kind), ['invented-number']);
  answerQuestion(db, p.id, p.questions[0].id, 'Within 2 days.');
  assert.deepEqual(proposalFlags(db, p.id), []);
  db.close();
});

test('the delivered, approved project may be cited as delivered', () => {
  assert.deepEqual(kinds('I delivered Clinic Dashboard, with weekly charts.'), []);
});

test('numbers compare as amounts, and sentences are cut where a reader would cut them', () => {
  assert.deepEqual(numbersIn('$5,000 or 5000 or 5k, 2.5 and 40%'), ['5000', '5000', '5000', '2.5', '40']);
  assert.deepEqual(numbersIn('Web3 S3 3D v2 https://x.test/12'), []);
  assert.deepEqual(sentencesOf('One. Two? Three!\nFour uses Next.js here.'), ['One.', 'Two?', 'Three!', 'Four uses Next.js here.']);
});

// ── §13.5 and the block ───────────────────────────────────────────────────

test('§13.5: unapproved claims and planned work cannot appear as accomplishments without a flag blocking approval', async () => {
  const db = freshDb();
  for (const e of [DELIVERED, PLANNED, UNAPPROVED]) addEntry(db, e);
  const draft = 'I delivered Booking Helper. My Quiet Client Portal shipped too. I have 9 happy clients.';
  const p = await openProposal(db, addJob(db), fakeModel(draft));

  // The AI's own first draft is checked, not only Dane's edits.
  assert.equal(p.draft, draft);
  assert.deepEqual(proposalFlags(db, p.id).map((f) => f.kind), ['planned-as-delivered', 'unapproved-evidence', 'invented-number']);
  const block = approvalBlock(db, p.id);
  assert.equal(block.blocked, true);
  assert.equal(block.flags.length, 3);

  // Each flag clears only when its claim is fixed; approval stays blocked until all are.
  assert.ok(saveDraft(db, p.id, 'I am planning Booking Helper. My Quiet Client Portal shipped too.'));
  assert.deepEqual(proposalFlags(db, p.id).map((f) => f.kind), ['unapproved-evidence']);
  assert.equal(approvalBlock(db, p.id).blocked, true);
  assert.ok(saveDraft(db, p.id, 'I am planning Booking Helper, and I would build your dashboard in Next.js.'));
  assert.deepEqual(approvalBlock(db, p.id), { blocked: false });

  // Switching an entry's status back to planned flags a sentence that was clear: the check reads the portfolio as it is now.
  assert.ok(saveDraft(db, p.id, 'I delivered Clinic Dashboard.'));
  assert.equal(approvalBlock(db, p.id).blocked, false);
  const clinic = db.prepare("SELECT id FROM portfolio_evidence WHERE project = 'Clinic Dashboard'").get().id;
  const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = getEntry(db, clinic);
  updateEntry(db, clinic, { ...fields, status: 'planned' });
  assert.equal(approvalBlock(db, p.id).blocked, true);
  db.close();
});

test('a proposal with no draft, or none at all, cannot be approved either', async () => {
  const db = freshDb();
  const id = addJob(db);
  const p = await openProposal(db, id, { getKey: () => null, fetchImpl: async () => { throw new Error('no call expected'); } });
  assert.equal(p.draft, null);
  assert.deepEqual(approvalBlock(db, p.id), { blocked: true, reasons: ['There is no draft to approve yet.'], flags: [] });
  assert.equal(approvalBlock(db, 99999).blocked, true);
  db.close();
});

// ── the workspace's save runs the check ───────────────────────────────────

test('saving an edited draft runs the check at once and says whether it is clear', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-claim-test-'));
  const savedDir = process.env.UB_DATA_DIR;
  process.env.UB_DATA_DIR = dir;
  useDraftDepsForTests(fakeModel('Hello, I would build your dashboard in Next.js.'));
  try {
    const setup = freshDb(join(dir, 'app.sqlite'));
    addEntry(setup, PLANNED);
    const p = await openProposal(setup, addJob(setup));
    setup.close();

    const post = (obj) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(obj)) body.set(k, v);
      return postWorkspace(new Request('http://mac-mini.local:4280/api/proposals', { method: 'POST', body }));
    };
    const r1 = await post({ proposal: String(p.id), action: 'edit-draft', draft: 'I delivered Booking Helper.\r\n' });
    assert.equal(r1.headers.get('location'), `/proposals/${p.id}?saved=draft-flagged#draft`);
    let db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(getProposal(db, p.id).draft, 'I delivered Booking Helper.');
    assert.ok(getProposal(db, p.id).editedAt, 'the edit is marked as Dane’s');
    assert.equal(approvalBlock(db, p.id).blocked, true);
    db.close();

    const r2 = await post({ proposal: String(p.id), action: 'edit-draft', draft: 'I am planning Booking Helper.' });
    assert.equal(r2.headers.get('location'), `/proposals/${p.id}?saved=draft#draft`);
    db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(approvalBlock(db, p.id).blocked, false);
    db.close();

    assert.equal((await post({ proposal: String(p.id), action: 'edit-draft', draft: '   ' })).headers.get('location'), `/proposals/${p.id}?error=bad-form`, 'an empty draft is not saved');
  } finally {
    useDraftDepsForTests(null);
    if (savedDir === undefined) delete process.env.UB_DATA_DIR;
    else process.env.UB_DATA_DIR = savedDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the form reader takes a draft edit, and refuses an empty or oversized one', () => {
  const form = (obj) => ({ get: (k) => obj[k] ?? null });
  assert.deepEqual(readWorkspaceForm(form({ proposal: '3', action: 'edit-draft', draft: ' Hi.\r\nThanks. ' })), { kind: 'edit-draft', proposalId: 3, draft: 'Hi.\nThanks.' });
  assert.equal(readWorkspaceForm(form({ proposal: '3', action: 'edit-draft', draft: '' })), null);
  assert.equal(readWorkspaceForm(form({ proposal: '3', action: 'edit-draft', draft: 'x'.repeat(10_001) })), null);
});
