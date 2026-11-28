// A proposal's history (UB-26): every change to the draft or the screening
// questions and answers keeps a numbered copy of the whole proposal, and no
// copy can ever change afterwards. Every job here is made up; no test calls
// the real API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationFiles, MIGRATIONS_DIR, openDatabase, runMigrations } from '../lib/db.ts';
import { saveJob } from '../lib/jobs.ts';
import { DEFAULT_SETTINGS, savePreferences } from '../lib/preferences.ts';
import { addQuestion, answerQuestion, DRAFT_MODEL, getProposal, openProposal, saveDraft, writeDraft } from '../lib/draft.ts';
import { approve, approvalState, fingerprintOf } from '../lib/approval.ts';
import { latestVersion, proposalVersions, versionCount as countVersions } from '../lib/proposalVersions.ts';
import { markSent } from '../lib/sent.ts';
import { compareVersions, defaultPair, versionFingerprint, versionHistory } from '../lib/versionHistory.ts';

const AI_DRAFT = 'Hello, I would build your sales dashboard in Next.js and keep you posted every week.';
const POST_TEXT = 'We need a sales dashboard in Next.js.\n\nScreening questions:\n1. How soon can you start?\n2. Have you used Postgres?';

function fakeModel(text = AI_DRAFT, status = 200) {
  return {
    getKey: () => 'sk-ant-fake-test-key-2626',
    fetchImpl: async () =>
      status === 200
        ? new Response(
            JSON.stringify({ model: DRAFT_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 250 } }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status }),
  };
}

function freshDb(path = ':memory:', dir = MIGRATIONS_DIR) {
  const db = openDatabase(path);
  runMigrations(db, dir);
  savePreferences(db, { ...DEFAULT_SETTINGS, themes: ['Dashboards'], requiredTech: ['Next.js'], exclusions: [] });
  return db;
}

let n = 0;
function addJob(db, description = POST_TEXT) {
  n++;
  const saved = saveJob(db, {
    url: `https://www.upwork.com/jobs/~01version${String(n).padStart(6, '0')}`,
    title: `Made-up dashboard job ${n}`,
    description,
    budget: '$2,000',
    jobType: 'fixed',
    postedAt: null,
    client: null,
    connectsCost: null,
  });
  assert.ok(saved.ok);
  return saved.id;
}

const versionCount = (db, id) => proposalVersions(db, id).length;
/** The whole proposal as it is now, in a version's shape. */
const asNow = (db, id) => {
  const p = getProposal(db, id);
  return { draft: p.draft, answers: p.questions.map((q) => [q.question, q.answer ?? '']) };
};
const rawRows = (db) => db.prepare('SELECT * FROM proposal_version ORDER BY id').all().map((r) => ({ ...r }));

// ── saving ────────────────────────────────────────────────────────────────

test('the first AI draft saves version 1, holding the draft and every question', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  const versions = proposalVersions(db, p.id);
  assert.equal(versions.length, 1);
  const [v1] = versions;
  assert.equal(v1.versionNo, 1);
  assert.equal(v1.change, 'first-draft');
  assert.equal(v1.author, 'AI');
  assert.equal(v1.draft, AI_DRAFT);
  assert.deepEqual(v1.answers, [
    ['How soon can you start?', ''],
    ['Have you used Postgres?', ''],
  ]);
  assert.match(v1.savedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('no version is kept while the AI has not written a draft; the retried draft is version 1', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel(AI_DRAFT, 529));
  assert.equal(p.draft, null);
  assert.ok(answerQuestion(db, p.id, p.questions[0].id, 'Monday.'));
  assert.equal(versionCount(db, p.id), 0, 'nothing Dane could send yet, so no version');

  await writeDraft(db, p.id, fakeModel());
  const versions = proposalVersions(db, p.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].versionNo, 1);
  assert.equal(versions[0].change, 'first-draft');
  assert.deepEqual(versions[0].answers[0], ['How soon can you start?', 'Monday.']);
});

test('a draft edit adds exactly one new version, numbered one higher, holding the whole proposal', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  assert.ok(saveDraft(db, p.id, 'My own words about the dashboard.'));
  const versions = proposalVersions(db, p.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[1].versionNo, 2);
  assert.equal(versions[1].change, 'draft');
  assert.equal(versions[1].author, 'Dane');
  assert.deepEqual({ draft: versions[1].draft, answers: versions[1].answers }, asNow(db, p.id));
});

test('an answer adds exactly one new version, numbered one higher, holding the whole proposal', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  assert.ok(answerQuestion(db, p.id, p.questions[1].id, 'Yes, for five years.'));
  const versions = proposalVersions(db, p.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[1].versionNo, 2);
  assert.equal(versions[1].change, 'answer');
  assert.equal(versions[1].author, 'Dane');
  assert.deepEqual(versions[1].answers, [
    ['How soon can you start?', ''],
    ['Have you used Postgres?', 'Yes, for five years.'],
  ]);
  assert.deepEqual({ draft: versions[1].draft, answers: versions[1].answers }, asNow(db, p.id));
});

test('an added question adds exactly one new version, numbered one higher, holding the whole proposal', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  assert.ok(addQuestion(db, p.id, 'What is your hourly rate?'));
  const versions = proposalVersions(db, p.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[1].versionNo, 2);
  assert.equal(versions[1].change, 'question');
  assert.equal(versions[1].answers.length, 3);
  assert.deepEqual(versions[1].answers[2], ['What is your hourly rate?', '']);
  assert.deepEqual({ draft: versions[1].draft, answers: versions[1].answers }, asNow(db, p.id));
});

test('saving the same text again adds no version', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  assert.ok(saveDraft(db, p.id, AI_DRAFT), 'the AI text saved as-is');
  assert.equal(versionCount(db, p.id), 1);
  assert.ok(saveDraft(db, p.id, 'Changed once.'));
  assert.ok(saveDraft(db, p.id, 'Changed once.'));
  assert.equal(versionCount(db, p.id), 2);
  assert.ok(answerQuestion(db, p.id, p.questions[0].id, 'Monday.'));
  assert.ok(answerQuestion(db, p.id, p.questions[0].id, 'Monday.'));
  assert.equal(versionCount(db, p.id), 3);
});

test('a change that saves nothing keeps no version', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  assert.equal(answerQuestion(db, p.id, 999_999, 'Nope.'), false, 'no such question');
  assert.equal(saveDraft(db, 999_999, 'Nope.'), false, 'no such proposal');
  assert.equal(versionCount(db, p.id), 1);
});

// ── never changing ────────────────────────────────────────────────────────

test('earlier versions never change: after several edits each reads back byte for byte as it was saved', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  const snapshots = [rawRows(db)];
  assert.ok(answerQuestion(db, p.id, p.questions[0].id, 'Next Monday.'));
  snapshots.push(rawRows(db));
  assert.ok(saveDraft(db, p.id, 'Hello — my own words, with “quotes” and an emoji 🚀.\n\nSecond paragraph.'));
  snapshots.push(rawRows(db));
  assert.ok(addQuestion(db, p.id, 'Can you start this week?'));
  snapshots.push(rawRows(db));
  assert.ok(answerQuestion(db, p.id, p.questions[0].id, null));
  assert.ok(saveDraft(db, p.id, 'A shorter draft.'));

  const final = rawRows(db);
  assert.equal(final.length, 6);
  assert.deepEqual(final.map((r) => r.version_no), [1, 2, 3, 4, 5, 6]);
  for (const snap of snapshots) assert.deepEqual(final.slice(0, snap.length), snap, 'every earlier row is exactly as it was');
  assert.equal(final[2].draft, 'Hello — my own words, with “quotes” and an emoji 🚀.\n\nSecond paragraph.');
});

test('the database refuses a direct UPDATE or DELETE of a version', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  const before = rawRows(db);
  assert.throws(() => db.prepare("UPDATE proposal_version SET draft = 'tampered' WHERE proposal_id = ?").run(p.id), /can never be changed/);
  assert.throws(() => db.prepare('UPDATE proposal_version SET version_no = 9').run(), /can never be changed/);
  assert.throws(() => db.prepare('DELETE FROM proposal_version WHERE proposal_id = ?').run(p.id), /can never be deleted/);
  assert.throws(() => db.prepare('DELETE FROM proposal_version').run(), /can never be deleted/);
  assert.deepEqual(rawRows(db), before);
});

test('two versions of one proposal can never share a number', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  assert.throws(
    () => db.prepare("INSERT INTO proposal_version (proposal_id, version_no, draft, answers, change, author) VALUES (?, 1, 'x', '[]', 'draft', 'Dane')").run(p.id),
    /UNIQUE/,
  );
});

// ── one transaction ───────────────────────────────────────────────────────

/** Make every version save fail, the way a full disk or a bug would. */
const breakVersions = (db) =>
  db.exec("CREATE TRIGGER test_break_versions BEFORE INSERT ON proposal_version BEGIN SELECT RAISE(ABORT, 'test: the version could not be saved'); END;");

test('if saving the version fails, the change itself is not saved either', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  const before = getProposal(db, p.id);
  breakVersions(db);

  assert.throws(() => saveDraft(db, p.id, 'An edit that must not stick.'), /could not be saved/);
  assert.throws(() => answerQuestion(db, p.id, p.questions[0].id, 'An answer that must not stick.'), /could not be saved/);
  assert.throws(() => addQuestion(db, p.id, 'A question that must not stick?'), /could not be saved/);
  assert.deepEqual(getProposal(db, p.id), before, 'the draft, the answers and the questions are unchanged');
  assert.equal(db.isTransaction, false, 'no transaction is left open');

  // The AI's first draft too.
  const p2 = await openProposal(db, addJob(db), fakeModel(AI_DRAFT, 529));
  await assert.rejects(writeDraft(db, p2.id, fakeModel()), /could not be saved/);
  assert.equal(getProposal(db, p2.id).draft, null, 'the first draft was not saved without its version');
});

// ── approving and sending, unchanged ─────────────────────────────────────

test('a version holds what the approval fingerprint is worked out from', async () => {
  const db = freshDb();
  const p = await openProposal(db, addJob(db), fakeModel());
  for (const q of p.questions) assert.ok(answerQuestion(db, p.id, q.id, 'Next Monday.'));
  const now = getProposal(db, p.id);
  assert.equal(approve(db, now.id, fingerprintOf(now)).ok, true);
  const v = latestVersion(db, p.id);
  const fromVersion = fingerprintOf({ draft: v.draft, questions: v.answers.map(([question, answer]) => ({ question, answer })) });
  assert.equal(fromVersion, fingerprintOf(now));
  assert.equal(approvalState(db, p.id).state, 'approved', 'keeping versions does not touch the approval');
});

// ── the migration ─────────────────────────────────────────────────────────

test('the migration gives each existing proposal with a draft its version 1, as it stands today', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-versions-'));
  try {
    // A database from before this migration: every file but 012.
    const older = join(dir, 'older');
    const all = join(dir, 'all');
    mkdirSync(older);
    mkdirSync(all);
    for (const name of migrationFiles()) {
      copyFileSync(join(MIGRATIONS_DIR, name), join(all, name));
      if (name < '012_') copyFileSync(join(MIGRATIONS_DIR, name), join(older, name));
    }
    const db = freshDb(join(dir, 'app.sqlite'), older);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'proposal_version'").get(), undefined);

    const aiOnly = Number(db.prepare('INSERT INTO proposal (opportunity_id, draft, drafted_at) VALUES (?, ?, ?)').run(addJob(db), 'The AI draft.', '2026-11-01T10:00:00.000Z').lastInsertRowid);
    db.prepare('INSERT INTO proposal_question (proposal_id, question, answer) VALUES (?, ?, ?)').run(aiOnly, 'First?', 'Yes.');
    db.prepare('INSERT INTO proposal_question (proposal_id, question, answer) VALUES (?, ?, NULL)').run(aiOnly, 'Second?');
    const edited = Number(
      db.prepare('INSERT INTO proposal (opportunity_id, draft, drafted_at, edited_at) VALUES (?, ?, ?, ?)').run(addJob(db), 'Dane rewrote it.', '2026-11-02T10:00:00.000Z', '2026-11-03T10:00:00.000Z').lastInsertRowid,
    );
    const noDraft = Number(db.prepare("INSERT INTO proposal (opportunity_id, draft_problem) VALUES (?, 'overloaded')").run(addJob(db)).lastInsertRowid);

    assert.deepEqual(runMigrations(db, all), ['012_proposal_version.sql']);

    const [a] = proposalVersions(db, aiOnly);
    assert.deepEqual(
      { no: a.versionNo, draft: a.draft, answers: a.answers, change: a.change, author: a.author, at: a.savedAt },
      { no: 1, draft: 'The AI draft.', answers: [['First?', 'Yes.'], ['Second?', '']], change: 'first-draft', author: 'AI', at: '2026-11-01T10:00:00.000Z' },
    );
    const [e] = proposalVersions(db, edited);
    assert.deepEqual(
      { no: e.versionNo, draft: e.draft, answers: e.answers, change: e.change, author: e.author, at: e.savedAt },
      { no: 1, draft: 'Dane rewrote it.', answers: [], change: 'draft', author: 'Dane', at: '2026-11-03T10:00:00.000Z' },
    );
    assert.equal(versionCount(db, noDraft), 0, 'a proposal with no draft starts with no history');

    // History carries on from there.
    assert.ok(saveDraft(db, aiOnly, 'Now my own words.'));
    assert.deepEqual(proposalVersions(db, aiOnly).map((v) => v.versionNo), [1, 2]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── reading the history (UB-29) ───────────────────────────────────────────

/** A proposal with every question answered, ready to approve. */
async function answeredProposal(db) {
  const p = await openProposal(db, addJob(db), fakeModel());
  for (const q of p.questions) assert.ok(answerQuestion(db, p.id, q.id, 'Next Monday.'));
  return getProposal(db, p.id);
}
const rowCounts = (db) =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]),
  );

test('the history lists every version newest first, with number, kind of change, whose words and time', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  assert.ok(saveDraft(db, p.id, 'My own words.'));
  const { versions } = versionHistory(db, p.id);
  assert.deepEqual(
    versions.map((v) => [v.versionNo, v.change, v.author]),
    [
      [4, 'draft', 'Dane'],
      [3, 'answer', 'Dane'],
      [2, 'answer', 'Dane'],
      [1, 'first-draft', 'AI'],
    ],
  );
  for (const v of versions) assert.match(v.savedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(defaultPair(versionHistory(db, p.id)), [3, 4], 'by default the newest against the one before it');
});

test('the version Dane approved is marked Approved, and says when that approval was later cancelled and why', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  assert.equal(approve(db, p.id, fingerprintOf(p)).ok, true);
  let h = versionHistory(db, p.id);
  const approvedNo = h.versions[0].versionNo;
  assert.equal(h.versions[0].fingerprint, fingerprintOf(p));
  assert.equal(h.versions[0].approvals.length, 1);
  assert.equal(h.versions[0].approvals[0].stands, true);
  assert.equal(h.versions[0].approvals[0].cancelledWhy, null);
  assert.ok(h.versions.slice(1).every((v) => v.approvals.length === 0), 'only the approved version is marked');

  assert.ok(saveDraft(db, p.id, 'Changed after approval.'));
  assert.equal(approvalState(db, p.id).state, 'cancelled');
  h = versionHistory(db, p.id);
  const marked = h.versions.find((v) => v.versionNo === approvedNo);
  assert.equal(marked.approvals[0].stands, false);
  assert.ok(marked.approvals[0].cancelledAt);
  assert.match(marked.approvals[0].cancelledWhy, /draft’s text was changed/);
  assert.equal(h.versions[0].approvals.length, 0, 'the edit after it is not approved');
});

test('the version a sent record points to, through its approval, is marked Sent', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  const fp = fingerprintOf(p);
  assert.equal(approve(db, p.id, fp).ok, true);
  assert.equal(markSent(db, p.id, fp).ok, true);
  assert.ok(saveDraft(db, p.id, 'A follow-up edit after sending.'));
  const h = versionHistory(db, p.id);
  const sent = h.versions.filter((v) => v.sent.length > 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].fingerprint, fp);
  assert.equal(sent[0].approvals.length, 1);
  assert.equal(sent[0].sent[0].approvalId, sent[0].approvals[0].approvalId);
  assert.equal(h.versions[0].sent.length, 0, 'the newer edit was not sent');
});

test('words changed and changed back: the approval marks the version he was looking at, not the older twin', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  const original = p.draft;
  assert.ok(saveDraft(db, p.id, 'A detour.'));
  assert.ok(saveDraft(db, p.id, original));
  const now = getProposal(db, p.id);
  assert.equal(approve(db, p.id, fingerprintOf(now)).ok, true);
  const h = versionHistory(db, p.id);
  const twins = h.versions.filter((v) => v.fingerprint === fingerprintOf(now));
  assert.equal(twins.length, 2);
  assert.deepEqual(twins.map((v) => v.approvals.length), [1, 0], 'newest twin carries the mark');
});

test('comparing two versions: the draft and each answer line up old on the left, new on the right', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  assert.ok(saveDraft(db, p.id, `${AI_DRAFT}\nA second line.`));
  assert.ok(addQuestion(db, p.id, 'What is your rate?'));
  const h = versionHistory(db, p.id);
  const newest = h.versions[0].versionNo;
  const cmp = compareVersions(h, newest, 1);
  assert.equal(cmp.older.versionNo, 1, 'older always on the left, whichever way round asked');
  assert.equal(cmp.newer.versionNo, newest);
  assert.deepEqual(cmp.draft, [
    { left: { text: AI_DRAFT, kind: 'same' }, right: { text: AI_DRAFT, kind: 'same' } },
    { left: null, right: { text: 'A second line.', kind: 'added' } },
  ]);
  assert.deepEqual(
    cmp.answers.map((a) => [a.question, a.in, a.rows.map((r) => [r.left?.kind ?? null, r.right?.kind ?? null])]),
    [
      ['How soon can you start?', 'both', [[null, 'added']]],
      ['Have you used Postgres?', 'both', [[null, 'added']]],
      ['What is your rate?', 'newer', []],
    ],
  );
  assert.equal(versionFingerprint(h.versions[0]), fingerprintOf(getProposal(db, p.id)));
});

test('two questions with the same wording: each answer is compared with its own question, not the other one', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  assert.ok(addQuestion(db, p.id, 'Anything else?'));
  assert.ok(addQuestion(db, p.id, 'Anything else?'));
  const [first, second] = getProposal(db, p.id).questions.slice(-2);
  assert.ok(answerQuestion(db, p.id, first.id, 'A'));
  const before = versionHistory(db, p.id).versions[0].versionNo;
  assert.ok(answerQuestion(db, p.id, second.id, 'B'));
  const h = versionHistory(db, p.id);
  const cmp = compareVersions(h, before, h.versions[0].versionNo);
  const alike = cmp.answers.filter((a) => a.question === 'Anything else?');
  assert.equal(alike.length, 2, 'both questions are shown');
  assert.deepEqual(alike[0].rows, [{ left: { text: 'A', kind: 'same' }, right: { text: 'A', kind: 'same' } }], 'the first answer did not change');
  assert.deepEqual(alike[1].rows, [{ left: null, right: { text: 'B', kind: 'added' } }], 'only the second answer was added');
  assert.deepEqual(alike.map((a) => a.in), ['both', 'both']);
});

test('a send whose approval matches no saved version is still reported, never dropped', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  // As if approved and sent before versions were kept, then edited: the
  // approval's fingerprint matches none of the saved versions.
  const approvalId = Number(
    db
      .prepare("INSERT INTO approval (proposal_id, fingerprint, approved_draft, approved_answers) VALUES (?, ?, 'Old words.', '[]')")
      .run(p.id, 'f'.repeat(64)).lastInsertRowid,
  );
  db.prepare('INSERT INTO sent_record (proposal_id, approval_id) VALUES (?, ?)').run(p.id, approvalId);
  const h = versionHistory(db, p.id);
  assert.ok(h.versions.every((v) => v.sent.length === 0 && v.approvals.length === 0));
  assert.deepEqual(h.unmatchedApprovals.map((a) => a.approvalId), [approvalId]);
  assert.deepEqual(h.unmatchedSent.map((s) => s.approvalId), [approvalId]);
  assert.match(h.unmatchedSent[0].confirmedAt, /^\d{4}-\d\d-\d\dT/);
});

test('the workspace count of versions comes from counting rows, and matches the history', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  assert.ok(saveDraft(db, p.id, 'My own words.'));
  assert.equal(countVersions(db, p.id), versionHistory(db, p.id).versions.length);
  assert.equal(countVersions(db, 999_999), 0);
});

test('a version number that is not this proposal’s gives nothing, never another proposal’s text', async () => {
  const db = freshDb();
  const one = await answeredProposal(db);
  const other = await openProposal(db, addJob(db), fakeModel('Text of a different proposal.'));
  assert.equal(compareVersions(versionHistory(db, other.id), 1, 3), undefined, 'the other proposal has only version 1');
  assert.equal(compareVersions(versionHistory(db, one.id), 1, 99), undefined);
  assert.deepEqual(versionHistory(db, 999_999), { versions: [], unmatchedApprovals: [], unmatchedSent: [] }, 'an unknown proposal has no history');
  assert.equal(defaultPair(versionHistory(db, 999_999)), undefined);
});

test('reading the history and comparing versions writes nothing to the database', async () => {
  const db = freshDb();
  const p = await answeredProposal(db);
  const fp = fingerprintOf(p);
  assert.equal(approve(db, p.id, fp).ok, true);
  assert.equal(markSent(db, p.id, fp).ok, true);
  assert.ok(saveDraft(db, p.id, 'After sending.'));
  const before = rowCounts(db);
  const changesBefore = db.prepare('SELECT total_changes() AS n').get().n;
  const h = versionHistory(db, p.id);
  compareVersions(h, ...defaultPair(h));
  compareVersions(h, 1, h.versions[0].versionNo);
  assert.deepEqual(rowCounts(db), before);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changesBefore, 'not a single row written');
});

test('the history page reads only: no write, no form that posts', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../app/proposals/[id]/versions/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /method="post"|action="\/api/i);
  assert.doesNotMatch(page, /\b(saveDraft|answerQuestion|addQuestion|approve|markSent|recordVersion|changeWithVersion)\b/);
  const workspace = readFileSync(new URL('../app/proposals/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /href=\{`\/proposals\/\$\{proposal\.id\}\/versions`\}/, 'the workspace links to the history');
});
