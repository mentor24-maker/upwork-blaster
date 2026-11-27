// The Pipeline board (task 3.5): a job Dane marked "I sent it" is on the
// board in "Sent"; he moves it through replied, interviewing, won or lost,
// and his notes and next action read back. Only his signed-in click changes
// it, and nothing here talks to Upwork. Every job here is made up; no test
// calls the real API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { openDatabase, REPO_DIR, runMigrations } from '../lib/db.ts';
import { saveJob } from '../lib/jobs.ts';
import { DEFAULT_SETTINGS, savePreferences } from '../lib/preferences.ts';
import { answerQuestion, DRAFT_MODEL, getProposal, openProposal } from '../lib/draft.ts';
import { approve, fingerprintOf } from '../lib/approval.ts';
import { markSent } from '../lib/sent.ts';
import {
  addNote,
  buildPipeline,
  cutToChars,
  MAX_NEXT_ACTION,
  MAX_NOTE,
  moveJob,
  outcomeLines,
  pipelineCard,
  pipelineOutcomes,
  PIPELINE_STATUSES,
  readPipelineForm,
  setNextAction,
} from '../lib/pipeline.ts';
import { recordAiUsage } from '../lib/ai/usage.ts';
import { gate } from '../lib/gate.ts';
import { createSessionToken, SESSION_COOKIE } from '../lib/session.ts';
import { POST as postPipeline } from '../app/api/pipeline/route.ts';

const DRAFT = 'Hello, I would build your sales dashboard in Next.js and keep you posted every week.';
const POST_TEXT = 'We need a sales dashboard in Next.js.\n\nScreening questions:\n1. How soon can you start?';

function fakeModel(text) {
  return {
    getKey: () => 'sk-ant-fake-test-key-5555',
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
async function approvedProposal(db) {
  n++;
  const saved = saveJob(db, {
    url: `https://www.upwork.com/jobs/~01pipe${String(n).padStart(6, '0')}`,
    title: `Made-up pipeline job ${n}`,
    description: POST_TEXT,
    budget: '$2,000',
    jobType: 'fixed',
    postedAt: null,
    client: null,
    connectsCost: null,
  });
  assert.ok(saved.ok);
  const p = await openProposal(db, saved.id, fakeModel(DRAFT));
  for (const q of p.questions) assert.ok(answerQuestion(db, p.id, q.id, 'Next Monday.'));
  const ready = getProposal(db, p.id);
  assert.equal(approve(db, p.id, fingerprintOf(ready)).ok, true);
  return getProposal(db, p.id);
}

async function sentProposal(db) {
  const p = await approvedProposal(db);
  assert.equal(markSent(db, p.id, fingerprintOf(p)).ok, true);
  return p;
}

const column = (board, status) => board.columns.find((c) => c.status === status).cards.map((c) => c.proposalId);

// ── Only a job marked sent is on the board ───────────────────────────────

test('a job marked sent appears in "Sent"; one approved but not sent is not on the board', async () => {
  const db = freshDb();
  const notSent = await approvedProposal(db);
  const sent = await sentProposal(db);
  const board = buildPipeline(db);
  assert.deepEqual(board.columns.map((c) => c.status), ['sent', 'replied', 'interviewing', 'won', 'lost']);
  assert.equal(board.total, 1);
  assert.deepEqual(column(board, 'sent'), [sent.id]);
  assert.equal(pipelineCard(db, notSent.id), undefined);
  assert.deepEqual(moveJob(db, notSent.id, 'won'), { ok: false, reason: 'not-sent' });
  assert.deepEqual(addNote(db, notSent.id, 'hi'), { ok: false, reason: 'not-sent' });
  assert.deepEqual(setNextAction(db, notSent.id, 'call'), { ok: false, reason: 'not-sent' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pipeline_move').get().c, 0, 'nothing written for it');
});

// ── Acceptance: move through each status, read notes back ────────────────

test('a job moves through every status, and its notes and next action read back', async () => {
  const db = freshDb();
  const p = await sentProposal(db);
  assert.equal(pipelineCard(db, p.id).status, 'sent');

  const notes = [];
  for (const status of ['replied', 'interviewing', 'won', 'lost', 'sent']) {
    const moved = moveJob(db, p.id, status);
    assert.equal(moved.ok, true);
    assert.equal(moved.card.status, status);
    assert.deepEqual(column(buildPipeline(db), status), [p.id], `it sits in the ${status} column`);
    for (const other of PIPELINE_STATUSES.filter((s) => s !== status)) {
      assert.deepEqual(column(buildPipeline(db), other), [], `and nowhere else (${other})`);
    }
    const note = `Moved to ${status}.\nSecond line kept as typed.`;
    notes.unshift(note);
    assert.equal(addNote(db, p.id, `  ${note}\n`).ok, true);
  }
  assert.deepEqual(
    pipelineCard(db, p.id).notes.map((x) => x.note),
    notes,
    'every note, newest first, in his words',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pipeline_move WHERE proposal_id = ?').get(p.id).c, 5, 'each move kept');

  assert.equal(setNextAction(db, p.id, '  Reply to   their question by Friday ').card.nextAction, 'Reply to their question by Friday');
  assert.equal(setNextAction(db, p.id, 'Send the contract').card.nextAction, 'Send the contract', 'replaced, not added');
  assert.equal(setNextAction(db, p.id, '   ').card.nextAction, null, 'blank clears it');
});

test('moving to the status it is in changes nothing; a blank note is refused; a long note is cut', async () => {
  const db = freshDb();
  const p = await sentProposal(db);
  assert.equal(moveJob(db, p.id, 'sent').already, true);
  assert.equal(moveJob(db, p.id, 'replied').already, undefined);
  assert.equal(moveJob(db, p.id, 'replied').already, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pipeline_move').get().c, 1);
  assert.deepEqual(addNote(db, p.id, ' \n '), { ok: false, reason: 'empty' });
  assert.equal(addNote(db, p.id, 'x'.repeat(MAX_NOTE + 50)).card.notes[0].note.length, MAX_NOTE);
  assert.throws(() => moveJob(db, p.id, 'submitted'), /not a pipeline status/);
  assert.throws(() => db.prepare("INSERT INTO pipeline_move (proposal_id, status) VALUES (?, 'hired')").run(p.id), /CHECK/);
});

test('the board stays the same after the database is closed and opened again (a reload)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-pipeline-reload-'));
  try {
    const path = join(dir, 'app.sqlite');
    let db = freshDb(path);
    const p = await sentProposal(db);
    moveJob(db, p.id, 'interviewing');
    addNote(db, p.id, 'Call booked for Tuesday.');
    db.close();
    db = openDatabase(path);
    const card = pipelineCard(db, p.id);
    assert.equal(card.status, 'interviewing');
    assert.deepEqual(card.notes.map((x) => x.note), ['Call booked for Tuesday.']);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Long text is cut on whole characters; a failed save leaves nothing ───

test('a cut at each limit never splits an emoji in half', async () => {
  const db = freshDb();
  const p = await sentProposal(db);
  const emoji = '\u{1F600}';
  assert.equal(cutToChars(`ab${emoji}`, 3), `ab${emoji}`);
  assert.equal(cutToChars(`ab${emoji}c`, 3), `ab${emoji}`);
  assert.equal(cutToChars('abc', 5), 'abc');

  const nextFits = 'a'.repeat(MAX_NEXT_ACTION - 1) + emoji;
  assert.equal(setNextAction(db, p.id, nextFits).card.nextAction, nextFits, 'the emoji right at the limit is kept whole');
  assert.equal(setNextAction(db, p.id, 'a'.repeat(MAX_NEXT_ACTION) + emoji).card.nextAction, 'a'.repeat(MAX_NEXT_ACTION), 'one past it is dropped whole');

  const noteFits = 'n'.repeat(MAX_NOTE - 1) + emoji;
  assert.equal(addNote(db, p.id, noteFits + 'tail').card.notes[0].note, noteFits);
  assert.equal(addNote(db, p.id, 'n'.repeat(MAX_NOTE) + emoji).card.notes[0].note, 'n'.repeat(MAX_NOTE));
  for (const row of db.prepare('SELECT note AS t FROM pipeline_note UNION ALL SELECT next_action FROM pipeline_next_action').all()) {
    assert.doesNotMatch(String(row.t), /�/, 'no broken character stored');
  }
});

/** The database, except that once a write has run, the read-back query matching `pattern` fails. */
function failingReadBack(db, pattern) {
  let wrote = false;
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'prepare') {
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      }
      return (sql) => {
        const stmt = target.prepare(sql);
        if (/^\s*INSERT/i.test(sql)) {
          return { run: (...a) => { const r = stmt.run(...a); wrote = true; return r; } };
        }
        if (wrote && pattern.test(sql)) {
          return { get: () => { throw new Error('made-up read-back failure'); }, all: () => { throw new Error('made-up read-back failure'); } };
        }
        return stmt;
      };
    },
  });
}

test('a save whose read-back fails is undone, for a move, a note and a next action', async () => {
  const db = freshDb();
  const p = await sentProposal(db);
  const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

  assert.throws(() => moveJob(failingReadBack(db, /FROM pipeline_move/), p.id, 'won'), /made-up read-back failure/);
  assert.equal(count('pipeline_move'), 0, 'the move was rolled back');
  assert.throws(() => addNote(failingReadBack(db, /FROM pipeline_note/), p.id, 'A note'), /made-up read-back failure/);
  assert.equal(count('pipeline_note'), 0, 'the note was rolled back');
  assert.throws(() => setNextAction(failingReadBack(db, /FROM pipeline_next_action/), p.id, 'Call'), /made-up read-back failure/);
  assert.equal(count('pipeline_next_action'), 0, 'the next action was rolled back');

  assert.equal(db.isTransaction, false, 'no transaction left open');
  assert.equal(moveJob(db, p.id, 'won').card.status, 'won', 'and the board still works afterwards');
});

// ── The form ──────────────────────────────────────────────────────────────

test('the board form reads only its three actions on a proposal id', () => {
  const f = (o) => ({ get: (k) => (k in o ? o[k] : null) });
  assert.deepEqual(readPipelineForm(f({ proposal: '7', action: 'move', status: 'won' })), { proposalId: 7, action: 'move', status: 'won' });
  assert.deepEqual(readPipelineForm(f({ proposal: '7', action: 'note', text: 'hi' })), { proposalId: 7, action: 'note', text: 'hi' });
  assert.deepEqual(readPipelineForm(f({ proposal: '7', action: 'next', text: '' })), { proposalId: 7, action: 'next', text: '' });
  assert.equal(readPipelineForm(f({ proposal: '7', action: 'move', status: 'hired' })), null);
  assert.equal(readPipelineForm(f({ proposal: 'x', action: 'move', status: 'won' })), null);
  assert.equal(readPipelineForm(f({ proposal: '7', action: 'delete' })), null);
  assert.equal(readPipelineForm(f({ proposal: '7', action: 'note' })), null);
});

// ── Only Dane's signed-in click changes the board ─────────────────────────

test('only a signed-in click changes the board: the route refuses without the sign-in, and the gate does too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-pipeline-test-'));
  const saved = { dir: process.env.UB_DATA_DIR, pw: process.env.APP_PASSWORD, secret: process.env.APP_SESSION_SECRET };
  process.env.UB_DATA_DIR = dir;
  process.env.APP_PASSWORD = 'made-up-test-password';
  process.env.APP_SESSION_SECRET = 'made-up-test-secret-for-signing-cookies';
  const restore = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    const setup = freshDb(join(dir, 'app.sqlite'));
    const p = await sentProposal(setup);
    const notSent = await approvedProposal(setup);
    setup.close();

    const request = (obj, cookie) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(obj)) body.set(k, v);
      return new Request('http://mac-mini.local:4280/api/pipeline', { method: 'POST', body, headers: cookie ? { cookie } : {} });
    };
    const move = { proposal: String(p.id), action: 'move', status: 'interviewing' };

    assert.equal((await postPipeline(request(move))).status, 401, 'no sign-in: refused by the route itself');
    assert.equal((await postPipeline(request(move, `${SESSION_COOKIE}=forged.value`))).status, 401, 'a forged cookie: refused');
    assert.equal(gate(request(move))?.status, 401, 'and by the gate before it');
    let db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(pipelineCard(db, p.id).status, 'sent', 'nothing moved');
    db.close();

    const cookie = `${SESSION_COOKIE}=${createSessionToken({ password: process.env.APP_PASSWORD, secret: process.env.APP_SESSION_SECRET })}`;
    const loc = async (obj) => (await postPipeline(request(obj, cookie))).headers.get('location');
    assert.equal(await loc(move), `/pipeline?done=moved&job=${p.id}#job-${p.id}`);
    assert.equal(await loc(move), `/pipeline?done=already&job=${p.id}#job-${p.id}`);
    assert.equal(await loc({ proposal: String(p.id), action: 'note', text: 'They asked for a call.' }), `/pipeline?done=noted&job=${p.id}#job-${p.id}`);
    assert.equal(await loc({ proposal: String(p.id), action: 'note', text: '  ' }), `/pipeline?error=empty&job=${p.id}#job-${p.id}`);
    assert.equal(await loc({ proposal: String(p.id), action: 'next', text: '  ' }), `/pipeline?done=cleared&job=${p.id}#job-${p.id}`);
    assert.equal(await loc({ proposal: String(p.id), action: 'next', text: 'Call Tuesday 10am' }), `/pipeline?done=next&job=${p.id}#job-${p.id}`);
    assert.equal(await loc({ ...move, proposal: String(notSent.id) }), '/pipeline?error=not-sent');
    assert.equal(await loc({ ...move, status: 'hired' }), '/pipeline?error=bad-form');

    db = openDatabase(join(dir, 'app.sqlite'));
    const card = pipelineCard(db, p.id);
    assert.equal(card.status, 'interviewing');
    assert.deepEqual(card.notes.map((x) => x.note), ['They asked for a call.']);
    assert.equal(card.nextAction, 'Call Tuesday 10am');
    db.close();
  } finally {
    restore('UB_DATA_DIR', saved.dir);
    restore('APP_PASSWORD', saved.pw);
    restore('APP_SESSION_SECRET', saved.secret);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only lib/pipeline.ts writes the board, only the signed-in route calls it, and neither talks to Upwork', () => {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(full);
    }
  };
  walk(join(REPO_DIR, 'lib'));
  walk(join(REPO_DIR, 'app'));
  const rel = (f) => relative(REPO_DIR, f);
  const writers = files.filter((f) => /INSERT\s+INTO\s+pipeline_/i.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(writers, ['lib/pipeline.ts']);
  const callers = files
    .filter((f) => !f.endsWith('lib/pipeline.ts'))
    .filter((f) => /\b(applyPipelineAction|moveJob|addNote|setNextAction)\s*\(/.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(callers, ['app/api/pipeline/route.ts']);
  const route = readFileSync(join(REPO_DIR, 'app/api/pipeline/route.ts'), 'utf8');
  assert.match(route, /if \(!isSignedIn\(request\)\) return new Response\(null, \{ status: 401/);
  for (const f of ['lib/pipeline.ts', 'app/api/pipeline/route.ts']) {
    assert.doesNotMatch(readFileSync(join(REPO_DIR, f), 'utf8'), /\bfetch\s*\(|upwork\.com/i, `${f} has no connection to Upwork`);
  }
});

// ── Outcomes (task 6.4): counted from his own moves, spend kept apart ────

test('outcomes count each job once by the rule: ever reached for Replied and Interviewing, now in for Won and Lost', async () => {
  const db = freshDb();
  const notSent = await approvedProposal(db);
  const backToSent = await sentProposal(db);
  const lostOne = await sentProposal(db);
  const unWon = await sentProposal(db);
  const untouched = await sentProposal(db);

  // Sent → Replied → Sent, twice over: replied once, not twice.
  for (const s of ['replied', 'sent', 'replied', 'sent']) assert.equal(moveJob(db, backToSent.id, s).ok, true);
  for (const s of ['replied', 'interviewing', 'lost']) assert.equal(moveJob(db, lostOne.id, s).ok, true);
  for (const s of ['interviewing', 'won', 'interviewing']) assert.equal(moveJob(db, unWon.id, s).ok, true);

  const o = pipelineOutcomes(db);
  assert.deepEqual(
    { sent: o.sent, replied: o.replied, interviewing: o.interviewing, won: o.won, lost: o.lost },
    { sent: 4, replied: 2, interviewing: 2, won: 0, lost: 1 },
  );
  assert.equal(o.replyRate, 50);
  assert.equal(o.winRate, 0);
  assert.equal(pipelineCard(db, untouched.id).status, 'sent');
  assert.equal(pipelineCard(db, notSent.id), undefined, 'the approved-but-unsent proposal is not on the board');

  // Won now, for real: counted.
  assert.equal(moveJob(db, unWon.id, 'won').ok, true);
  const after = pipelineOutcomes(db);
  assert.equal(after.won, 1);
  assert.equal(after.winRate, 25);

  const lines = outcomeLines(after);
  assert.deepEqual(lines.measured, [
    'Sent: 4 · Replied: 2 · Interviewing: 2 · Won: 1 · Lost: 1',
    'Reply rate: 50% (2 of 4)',
    'Win rate: 25% (1 of 4)',
  ]);
  for (const line of lines.measured) assert.doesNotMatch(line, /\$|spend|price/i, 'no estimate in a measured line');
  for (const line of lines.estimated) assert.doesNotMatch(line, /rate:|Replied|Won/, 'no measured count in an estimated line');
});

test('a proposal approved but never marked sent is not counted anywhere', async () => {
  const db = freshDb();
  const p = await approvedProposal(db);
  const o = pipelineOutcomes(db);
  assert.deepEqual(
    { sent: o.sent, replied: o.replied, interviewing: o.interviewing, won: o.won, lost: o.lost },
    { sent: 0, replied: 0, interviewing: 0, won: 0, lost: 0 },
  );
  assert.deepEqual(moveJob(db, p.id, 'won'), { ok: false, reason: 'not-sent' }, 'and it cannot be moved onto the board');
  assert.equal(pipelineOutcomes(db).won, 0);
});

test('with nothing sent the rates are absent and the section says "No proposals sent yet."', async () => {
  const db = freshDb();
  await approvedProposal(db); // AI calls were made, but nothing was sent
  const o = pipelineOutcomes(db);
  assert.equal(o.sent, 0);
  assert.equal(o.replyRate, null);
  assert.equal(o.winRate, null);
  assert.equal(o.spendPerSentUsd, null, 'no divide-by-zero');
  const lines = outcomeLines(o);
  assert.deepEqual(lines, { measured: ['No proposals sent yet.'], estimated: [] });
  assert.doesNotMatch(JSON.stringify(lines), /NaN|Infinity/);
});

test('the AI spend per sent proposal is an estimate from priced calls, and an unpriced call is named, not counted as $0', async () => {
  const db = freshDb();
  await sentProposal(db);
  await sentProposal(db);
  db.prepare('DELETE FROM ai_usage').run(); // replace the drafting calls with made-up ones
  const MILLION = 1_000_000;
  const usage = { promptTokens: MILLION, completionTokens: 0, cachedTokens: 0, totalTokens: MILLION };
  recordAiUsage(db, { provider: 'anthropic', model: 'claude-sonnet-5-5', feature: 'draft', usage }); // $2.00
  recordAiUsage(db, { provider: 'anthropic', model: 'claude-sonnet-5-5', feature: 'draft', usage }); // $2.00

  let o = pipelineOutcomes(db);
  assert.equal(o.spendPerSentUsd, 2);
  assert.deepEqual(outcomeLines(o).estimated, [
    'AI spend per sent proposal: $2.00 ($4.00 across 2 calls, ÷ 2 sent)',
    'Worked out from the price table in the app (lib/ai/pricing.ts), not from a bill.',
  ]);

  recordAiUsage(db, { provider: 'anthropic', model: 'claude-mystery-9', feature: 'draft', usage });
  o = pipelineOutcomes(db);
  assert.equal(o.spendPerSentUsd, 2, 'the unpriced call is not added as $0 or as a guess');
  assert.equal(o.spend.unpricedCalls, 1);
  const [perSent, why] = outcomeLines(o).estimated;
  assert.equal(perSent, 'AI spend per sent proposal: $2.00 ($4.00 across 2 calls, ÷ 2 sent)');
  assert.match(why, /1 call not priced \(claude-mystery-9 has no price on record\), so the real total is higher\./);
});

test('the board page shows the outcomes under "Measured: from your own moves" and the spend under "Estimated"', () => {
  const page = readFileSync(join(REPO_DIR, 'app/pipeline/page.tsx'), 'utf8');
  assert.match(page, /outcomeLines\(pipelineOutcomes\(db\)\)/);
  assert.match(page, /<strong>Measured: from your own moves<\/strong>/);
  assert.match(page, /<strong>Estimated<\/strong>/);
  assert.ok(page.indexOf('data-pipeline="outcomes"') < page.indexOf('data-pipeline-column'), 'the Outcomes section sits above the columns');
});
