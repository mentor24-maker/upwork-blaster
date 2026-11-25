// Copy and "I sent it" (task 3.4, hand-off §13.11): copying is offered only on
// a proposal approved right now, "I sent it" records a send confirmed by Dane
// with the time (never one by the app), and only his signed-in click marks it.
// Every job here is made up; no test calls the real API or Upwork.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { openDatabase, REPO_DIR, runMigrations } from '../lib/db.ts';
import { saveJob } from '../lib/jobs.ts';
import { DEFAULT_SETTINGS, savePreferences } from '../lib/preferences.ts';
import { addEntry, getEntry, updateEntry } from '../lib/portfolio.ts';
import { answerQuestion, DRAFT_MODEL, getProposal, openProposal, saveDraft } from '../lib/draft.ts';
import { approvalState, approve, fingerprintOf } from '../lib/approval.ts';
import { copyText, latestSent, markSent } from '../lib/sent.ts';
import { gate } from '../lib/gate.ts';
import { createSessionToken, SESSION_COOKIE } from '../lib/session.ts';
import { POST as postSent } from '../app/api/sent/route.ts';

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
function addJob(db) {
  n++;
  const saved = saveJob(db, {
    url: `https://www.upwork.com/jobs/~01sent${String(n).padStart(6, '0')}`,
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

/** A proposal with every question answered, not yet approved. */
async function readyProposal(db, draft = DRAFT) {
  const p = await openProposal(db, addJob(db), fakeModel(draft));
  for (const q of p.questions) assert.ok(answerQuestion(db, p.id, q.id, 'Next Monday.'));
  return getProposal(db, p.id);
}

async function approvedProposal(db) {
  const p = await readyProposal(db);
  assert.equal(approve(db, p.id, fingerprintOf(p)).ok, true);
  return getProposal(db, p.id);
}

// ── Copy is offered only on a proposal approved right now ────────────────

test('Copy is not offered on a proposal that was never approved', async () => {
  const db = freshDb();
  const p = await readyProposal(db);
  assert.equal(copyText(db, p.id), undefined);
  assert.deepEqual(markSent(db, p.id, fingerprintOf(p)), { ok: false, reason: 'not-approved' });
  assert.equal(latestSent(db, p.id), undefined);
});

test('Copy gives the approved text and answers, byte for byte', async () => {
  const db = freshDb();
  const p = await approvedProposal(db);
  const c = copyText(db, p.id);
  assert.equal(c.draft, DRAFT);
  assert.deepEqual(c.answers, p.questions.map((q) => ({ question: q.question, answer: 'Next Monday.' })));
});

test('Copy is not offered once an edit cancels the approval, and "I sent it" is refused', async () => {
  const db = freshDb();
  const p = await approvedProposal(db);
  const fp = fingerprintOf(p);
  saveDraft(db, p.id, `${DRAFT} One more line.`);
  assert.equal(approvalState(db, p.id).state, 'cancelled');
  assert.equal(copyText(db, p.id), undefined);
  assert.deepEqual(markSent(db, p.id, fp), { ok: false, reason: 'not-approved' });
  assert.equal(latestSent(db, p.id), undefined);
});

test('Copy is not offered while a new flag holds the approval', async () => {
  const db = freshDb();
  const id = addEntry(db, { project: 'Clinic Dashboard', status: 'delivered', features: 'charts', links: [], approvedForUse: true });
  const p = await readyProposal(db, 'I delivered Clinic Dashboard, a charts tool.');
  assert.equal(approve(db, p.id, fingerprintOf(p)).ok, true);
  updateEntry(db, id, { ...getEntry(db, id), approvedForUse: false });
  assert.equal(approvalState(db, p.id).state, 'on-hold');
  assert.equal(copyText(db, p.id), undefined);
  assert.deepEqual(markSent(db, p.id, fingerprintOf(p)), { ok: false, reason: 'not-approved' });
  updateEntry(db, id, { ...getEntry(db, id), approvedForUse: true });
  assert.ok(copyText(db, p.id), 'offered again once the flag clears');
});

// ── "I sent it" records a send confirmed by Dane, with the time ──────────

test('"I sent it" records "sent by Dane" with the time, and never a send by the app', async () => {
  const db = freshDb();
  const p = await approvedProposal(db);
  const before = Date.now();
  const r = markSent(db, p.id, fingerprintOf(p));
  assert.equal(r.ok, true);
  assert.equal(r.already, false);
  assert.equal(r.sent.sentBy, 'Dane');
  const row = db.prepare('SELECT sent_by, confirmed_at FROM sent_record WHERE id = ?').get(r.sent.id);
  assert.equal(row.sent_by, 'Dane', 'the stored record itself says Dane');
  const at = Date.parse(row.confirmed_at);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, 'with the time he said so');
  assert.equal(r.sent.approvalId, approvalState(db, p.id).approval.id, 'tied to the approval it was sent under');

  assert.throws(
    () => db.prepare("INSERT INTO sent_record (proposal_id, approval_id, sent_by) VALUES (?, ?, 'app')").run(p.id, r.sent.approvalId),
    /CHECK constraint failed|UNIQUE/,
    'the table cannot hold a send by anyone but Dane',
  );
});

test('marking the same version sent twice writes one record', async () => {
  const db = freshDb();
  const p = await approvedProposal(db);
  const first = markSent(db, p.id, fingerprintOf(p));
  const again = markSent(db, p.id, fingerprintOf(p));
  assert.equal(again.ok, true);
  assert.equal(again.already, true);
  assert.equal(again.sent.id, first.sent.id);
  assert.equal(db.prepare('SELECT count(*) AS c FROM sent_record').get().c, 1);
});

test('a stale click is refused: the fingerprint must be the approved version', async () => {
  const db = freshDb();
  const p = await approvedProposal(db);
  assert.deepEqual(markSent(db, p.id, 'a'.repeat(64)), { ok: false, reason: 'changed' });
  assert.deepEqual(markSent(db, p.id, 'not-a-fingerprint'), { ok: false, reason: 'changed' });
  assert.deepEqual(markSent(db, 999999, fingerprintOf(p)), { ok: false, reason: 'not-found' });
  assert.equal(latestSent(db, p.id), undefined);
});

test('the record of what he sent survives a later edit', async () => {
  const db = freshDb();
  const p = await approvedProposal(db);
  const r = markSent(db, p.id, fingerprintOf(p));
  saveDraft(db, p.id, `${DRAFT} Edited after sending.`);
  assert.equal(copyText(db, p.id), undefined, 'the edited text is not approved, so not offered for copying');
  const kept = latestSent(db, p.id);
  assert.equal(kept.id, r.sent.id);
  assert.equal(kept.sentBy, 'Dane');
  const what = db.prepare('SELECT approved_draft FROM approval WHERE id = ?').get(kept.approvalId);
  assert.equal(what.approved_draft, DRAFT, 'and still points at the exact text he sent');
});

// ── Only Dane's signed-in click marks it sent ─────────────────────────────

test('only a signed-in click marks it sent: the route refuses without the sign-in, and the gate does too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-sent-test-'));
  const saved = { dir: process.env.UB_DATA_DIR, pw: process.env.APP_PASSWORD, secret: process.env.APP_SESSION_SECRET };
  process.env.UB_DATA_DIR = dir;
  process.env.APP_PASSWORD = 'made-up-test-password';
  process.env.APP_SESSION_SECRET = 'made-up-test-secret-for-signing-cookies';
  const restore = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    const setup = freshDb(join(dir, 'app.sqlite'));
    const unapproved = await readyProposal(setup);
    const p = await approvedProposal(setup);
    setup.close();
    const fp = fingerprintOf(p);

    const request = (obj, cookie) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(obj)) body.set(k, v);
      const headers = cookie ? { cookie } : {};
      return new Request('http://mac-mini.local:4280/api/sent', { method: 'POST', body, headers });
    };
    const form = { proposal: String(p.id), action: 'sent', fingerprint: fp };

    assert.equal((await postSent(request(form))).status, 401, 'no sign-in: refused by the route itself');
    assert.equal((await postSent(request(form, `${SESSION_COOKIE}=forged.value`))).status, 401, 'a forged cookie: refused');
    assert.equal(gate(request(form))?.status, 401, 'and by the gate before it');
    let db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(latestSent(db, p.id), undefined, 'nothing marked sent');
    db.close();

    const cookie = `${SESSION_COOKIE}=${createSessionToken({ password: process.env.APP_PASSWORD, secret: process.env.APP_SESSION_SECRET })}`;
    const stale = await postSent(request({ ...form, fingerprint: 'a'.repeat(64) }, cookie));
    assert.equal(stale.headers.get('location'), `/proposals/${p.id}/review?error=changed-sent`);
    const bad = await postSent(request({ ...form, action: 'approve' }, cookie));
    assert.equal(bad.headers.get('location'), `/proposals/${p.id}/review?error=bad-form`);
    const notApproved = await postSent(request({ ...form, proposal: String(unapproved.id), fingerprint: fingerprintOf(unapproved) }, cookie));
    assert.equal(notApproved.headers.get('location'), `/proposals/${unapproved.id}/review?error=not-approved`);

    const ok = await postSent(request(form, cookie));
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), `/proposals/${p.id}/review?done=sent`);
    const again = await postSent(request(form, cookie));
    assert.equal(again.headers.get('location'), `/proposals/${p.id}/review?done=already-sent`);
    db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(latestSent(db, p.id).sentBy, 'Dane');
    assert.equal(latestSent(db, unapproved.id), undefined);
    db.close();
  } finally {
    restore('UB_DATA_DIR', saved.dir);
    restore('APP_PASSWORD', saved.pw);
    restore('APP_SESSION_SECRET', saved.secret);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only lib/sent.ts writes a send, only the signed-in route calls it, and neither talks to Upwork', () => {
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
  const writers = files.filter((f) => /INSERT\s+INTO\s+sent_record\b/i.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(writers, ['lib/sent.ts']);
  const callers = files
    .filter((f) => !f.endsWith('lib/sent.ts'))
    .filter((f) => /\bmarkSent\s*\(/.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(callers, ['app/api/sent/route.ts']);
  const route = readFileSync(join(REPO_DIR, 'app/api/sent/route.ts'), 'utf8');
  assert.match(route, /if \(!isSignedIn\(request\)\) return new Response\(null, \{ status: 401/);
  for (const f of ['lib/sent.ts', 'app/api/sent/route.ts', 'app/proposals/[id]/review/copy_button.tsx']) {
    const src = readFileSync(join(REPO_DIR, f), 'utf8');
    assert.doesNotMatch(src, /\bfetch\s*\(|upwork\.com/i, `${f} has no connection to Upwork`);
  }
});

test('the review screen offers Copy and "I sent it" only inside the approved-now branch', () => {
  const page = readFileSync(join(REPO_DIR, 'app/proposals/[id]/review/page.tsx'), 'utf8');
  const guard = page.indexOf("{toCopy && state.state === 'approved' ? (");
  assert.ok(guard > 0, 'the send section is guarded on copyText and the approved state');
  const end = page.indexOf(') : null}', guard);
  const firstCopy = page.indexOf('<CopyButton');
  const sentForm = page.indexOf('action="/api/sent"');
  assert.ok(firstCopy > guard && firstCopy < end, 'every Copy button sits inside it');
  assert.ok(sentForm > guard && sentForm < end, 'and so does "I sent it"');
  assert.equal(page.lastIndexOf('<CopyButton') < end, true);
});
