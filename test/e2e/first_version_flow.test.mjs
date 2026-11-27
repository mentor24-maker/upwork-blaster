// The whole first version, end to end (task 3.6, hand-off §13.15): Dane signs
// in, saves his preferences and portfolio, pastes jobs, sees them ranked,
// pursues the best one, answers its question, approves the draft, copies it,
// marks it sent and tracks it on the Pipeline board.
//
// Every step goes through the same door a browser click does: the gate
// (lib/gate.ts, which proxy.ts runs on every request) and then the form's own
// route. Each step leans on what the one before it left behind, and a second
// test removes each step in turn and checks the flow then fails, so a step
// that quietly stops doing its part is caught.
//
// The jobs and portfolio entries are made up (test/e2e/fixtures). The AI is a
// fake: no request leaves the test, and the only address any request is even
// pointed at is the Claude API's. Nothing is ever sent to Upwork.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '../../lib/db.ts';
import { gate } from '../../lib/gate.ts';
import { SESSION_COOKIE } from '../../lib/session.ts';
import { ANTHROPIC_URL } from '../../lib/ai/client.ts';
import { EXTRACT_MODEL, useAiDepsForTests } from '../../lib/extractJob.ts';
import { DRAFT_MODEL, getProposal, useDraftDepsForTests } from '../../lib/draft.ts';
import { listJobs } from '../../lib/jobs.ts';
import { buildInbox } from '../../lib/inbox.ts';
import { proposalFlags } from '../../lib/claimCheck.ts';
import { approvalState, fingerprintOf } from '../../lib/approval.ts';
import { copyText, latestSent } from '../../lib/sent.ts';
import { buildPipeline, pipelineCard } from '../../lib/pipeline.ts';
import { POST as postSignIn } from '../../app/api/sign-in/route.ts';
import { POST as postPreferences } from '../../app/api/preferences/route.ts';
import { POST as postPortfolio } from '../../app/api/portfolio/route.ts';
import { POST as postJob } from '../../app/api/jobs/route.ts';
import { POST as postDecision } from '../../app/api/decisions/route.ts';
import { POST as postWorkspace } from '../../app/api/proposals/route.ts';
import { POST as postApproval } from '../../app/api/approvals/route.ts';
import { POST as postSent } from '../../app/api/sent/route.ts';
import { POST as postPipeline } from '../../app/api/pipeline/route.ts';
import { POST as postCopied } from '../../app/api/copied/route.ts';
import { activityLines, listActivity } from '../../lib/activity.ts';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const { jobs: JOBS } = fixture('jobs.json');
const { entries: PORTFOLIO } = fixture('portfolio.json');
const job = (key) => JOBS.find((j) => j.key === key);

const FAKE_KEY = 'sk-ant-fake-e2e-key-0000';
const PASSWORD = 'made-up-e2e-password';
const ORIGIN = 'http://mac-mini.local:4280';
// Names only the approved, delivered project, and no number the post or
// portfolio does not hold: the claim check has nothing to flag.
const DRAFT =
  'Hello! I delivered the Made-up Shop Sales Dashboard in Next.js and TypeScript, with daily sales per shop, ' +
  'and I would build yours the same way and keep you posted every week.';
const ANSWER = 'I can start next Monday.';

/** A fake Claude: answers extraction with the fixture's fields and a draft with DRAFT, and keeps every request. */
function fakeClaude() {
  const sent = [];
  const reply = (model, text) =>
    new Response(
      JSON.stringify({ model, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 500, output_tokens: 100 } }),
      { status: 200 },
    );
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), model: body.model, headers: init.headers, body });
    if (body.model === EXTRACT_MODEL) {
      const message = String(body.messages[0].content);
      const post = JOBS.find((j) => message.includes(j.title));
      return reply(EXTRACT_MODEL, JSON.stringify(post ? post.aiAnswer : {}));
    }
    if (body.model === DRAFT_MODEL) return reply(DRAFT_MODEL, DRAFT);
    return new Response(JSON.stringify({ error: { message: `unexpected model ${body.model}` } }), { status: 400 });
  };
  return { sent, deps: { getKey: () => FAKE_KEY, fetchImpl } };
}

/**
 * A browser click: the gate first, exactly as proxy.ts runs it, then the
 * form's route when the gate lets it through.
 */
async function click(ctx, path, route, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const headers = ctx.cookie ? { cookie: `${SESSION_COOKIE}=${ctx.cookie}` } : {};
  const request = new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers });
  const stopped = gate(request);
  if (stopped) return stopped;
  return route(request);
}

/** Where a click landed: the redirect it answered with, which every form in the app does. */
function landedOn(res, what) {
  assert.equal(res.status, 303, `${what}: expected a redirect, got ${res.status}`);
  return res.headers.get('location');
}

// ── The steps, in Dane's order. Each takes what the last one left on `ctx`. ──

const STEPS = [
  {
    name: 'sign in',
    leaves: ['signed-in'],
    async run(ctx) {
      const res = await click(ctx, '/api/sign-in', postSignIn, { password: PASSWORD });
      assert.equal(landedOn(res, 'sign in'), '/');
      const cookie = /ub_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
      assert.ok(cookie, 'signing in sets the session cookie');
      ctx.cookie = cookie[1];
    },
  },
  {
    name: 'save preferences',
    leaves: ['preferences-saved'],
    async run(ctx) {
      const res = await click(ctx, '/api/preferences', postPreferences, {
        themes: 'Dashboards',
        requiredTech: 'Next.js\nTypeScript',
        unsupportedTech: 'WordPress',
        exclusions: 'casino',
        weight_fit: '30',
        weight_budget: '25',
        weight_clarity: '20',
        weight_client: '15',
        weight_interest: '10',
      });
      assert.match(landedOn(res, 'preferences'), /^\/preferences\?saved=\d+$/);
    },
  },
  {
    name: 'add portfolio',
    leaves: ['portfolio-added'],
    async run(ctx) {
      for (const entry of PORTFOLIO) {
        const fields = { action: 'add', project: entry.project, status: entry.status, features: entry.features, links: entry.links };
        if (entry.approvedForUse) fields.approvedForUse = 'on';
        const res = await click(ctx, '/api/portfolio', postPortfolio, fields);
        assert.match(landedOn(res, `portfolio ${entry.project}`), /^\/portfolio\?saved=\d+$/);
      }
    },
  },
  {
    name: 'paste jobs',
    leaves: ['job-saved', 'job-extracted', 'job-scored'],
    async run(ctx) {
      ctx.jobIds = {};
      for (const j of JOBS) {
        // He pastes the link, title and post; the AI fills in the rest.
        const res = await click(ctx, '/api/jobs', postJob, { url: j.url, title: j.title, description: j.description });
        const saved = /^\/jobs\?saved=(\d+)$/.exec(landedOn(res, `job ${j.key}`));
        assert.ok(saved, `job ${j.key} was saved`);
        ctx.jobIds[j.key] = Number(saved[1]);
      }
      const strong = listJobs(ctx.db()).find((j) => j.id === ctx.jobIds.strong);
      assert.deepEqual([strong.budget, strong.jobType], ['$3,000', 'fixed'], 'the AI filled in the blanks it could prove');
    },
  },
  {
    name: 'rank',
    leaves: [],
    async run(ctx) {
      const inbox = buildInbox(ctx.db());
      assert.ok(inbox.top.length > 0, 'the Inbox ranks at least one job');
      const ranked = inbox.top.map((c) => c.job.id);
      assert.equal(inbox.top[0].job.id, ctx.jobIds.strong, 'the strong job is ranked first');
      assert.equal(inbox.top[0].rank, 1);
      assert.equal(inbox.top[0].portfolioEvidence?.includes('Made-up Shop Sales Dashboard'), true, 'his approved project is why');
      assert.ok(!ranked.includes(ctx.jobIds.weak), 'a job in technology he does not take is not ranked');
      assert.deepEqual(
        inbox.excluded.map((c) => c.job.id).sort(),
        [ctx.jobIds.weak, ctx.jobIds.excluded].sort(),
        'the WordPress and casino jobs are set apart, never ranked',
      );
      ctx.pick = inbox.top[0].job.id;
      // Ranking only reads: its line on the Activity page is the score the app gave each job when it was pasted.
      const page = activityLines(ctx.db()).map((l) => l.what);
      for (const c of [...inbox.top, ...inbox.excluded]) {
        assert.ok(page.some((w) => w.includes(`“${c.job.title}”`) && /^The app (scored|set)/.test(w)), `the Activity page says how “${c.job.title}” was ranked`);
      }
    },
  },
  {
    name: 'pursue',
    leaves: ['decision', 'proposal-opened', 'draft-created'],
    async run(ctx) {
      assert.ok(ctx.pick, 'there is a ranked job to pursue');
      const res = await click(ctx, '/api/decisions', postDecision, { id: String(ctx.pick), decision: 'pursue' });
      const opened = /^\/proposals\/(\d+)$/.exec(landedOn(res, 'pursue'));
      assert.ok(opened, 'Pursue opens the proposal workspace');
      ctx.proposalId = Number(opened[1]);
      const p = getProposal(ctx.db(), ctx.proposalId);
      assert.equal(p.opportunityId, ctx.jobIds.strong);
      assert.equal(p.draft, DRAFT, 'the first draft is written');
      assert.deepEqual(p.questions.map((q) => q.question), ['How soon can you start?']);
    },
  },
  {
    name: 'answer question',
    leaves: ['answer-saved'],
    async run(ctx) {
      assert.ok(ctx.proposalId, 'a job was pursued');
      const proposal = getProposal(ctx.db(), ctx.proposalId);
      assert.ok(proposal, 'the workspace is open');
      const [q] = proposal.questions;
      assert.ok(q, 'the post’s screening question is on it');
      const res = await click(ctx, '/api/proposals', postWorkspace, {
        proposal: String(ctx.proposalId),
        action: 'answer',
        question_id: String(q.id),
        answer: ANSWER,
      });
      assert.equal(landedOn(res, 'answer'), `/proposals/${ctx.proposalId}?saved=answer#q-${q.id}`);
    },
  },
  {
    name: 'approve',
    leaves: ['draft-approved'],
    async run(ctx) {
      const p = getProposal(ctx.db(), ctx.proposalId);
      assert.ok(p, 'there is a proposal to review');
      assert.deepEqual(proposalFlags(ctx.db(), ctx.proposalId), [], 'the claim check finds nothing unproven');
      // The review screen carries the fingerprint of the version it shows.
      const res = await click(ctx, '/api/approvals', postApproval, {
        proposal: String(ctx.proposalId),
        action: 'approve',
        fingerprint: fingerprintOf(p),
      });
      assert.equal(landedOn(res, 'approve'), `/proposals/${ctx.proposalId}/review?done=approved`);
    },
  },
  {
    name: 'copy',
    leaves: ['proposal-copied'],
    async run(ctx) {
      const copied = copyText(ctx.db(), ctx.proposalId);
      assert.ok(copied, 'Copy is offered on the approved proposal');
      // Each Copy button tells the app it copied, for the activity log.
      for (const part of ['text', ...copied.answers.map((_, i) => `answer-${i + 1}`)]) {
        const res = await click(ctx, '/api/copied', postCopied, { proposal: String(ctx.proposalId), part });
        assert.equal(res.status, 204, `copying ${part} is noted`);
      }
      ctx.copied = copied;
    },
  },
  {
    name: 'mark sent',
    leaves: ['proposal-sent'],
    async run(ctx) {
      assert.ok(ctx.copied, 'he copied the proposal before saying he sent it');
      const state = approvalState(ctx.db(), ctx.proposalId);
      assert.equal(state.state, 'approved');
      const res = await click(ctx, '/api/sent', postSent, {
        proposal: String(ctx.proposalId),
        action: 'sent',
        fingerprint: state.approval.fingerprint,
      });
      assert.equal(landedOn(res, 'sent'), `/proposals/${ctx.proposalId}/review?done=sent`);
    },
  },
  {
    name: 'track',
    leaves: ['pipeline-moved', 'pipeline-note', 'pipeline-next'],
    async run(ctx) {
      const at = `&job=${ctx.proposalId}#job-${ctx.proposalId}`;
      const p = String(ctx.proposalId);
      const moved = await click(ctx, '/api/pipeline', postPipeline, { proposal: p, action: 'move', status: 'replied' });
      assert.equal(landedOn(moved, 'move'), `/pipeline?done=moved${at}`);
      const noted = await click(ctx, '/api/pipeline', postPipeline, { proposal: p, action: 'note', text: 'They liked the dashboard idea.' });
      assert.equal(landedOn(noted, 'note'), `/pipeline?done=noted${at}`);
      const next = await click(ctx, '/api/pipeline', postPipeline, { proposal: p, action: 'next', text: 'Offer two times for a call.' });
      assert.equal(landedOn(next, 'next'), `/pipeline?done=next${at}`);
    },
  },
];

/** Where the whole flow must end: checked from the database, not from what the steps said. */
function assertFlowFinished(ctx) {
  const db = ctx.db();
  const p = getProposal(db, ctx.proposalId);
  assert.ok(p, 'a proposal exists');
  assert.equal(p.opportunityId, ctx.jobIds.strong, 'for the job ranked first');

  const state = approvalState(db, ctx.proposalId);
  assert.equal(state.state, 'approved', 'it is approved');
  assert.equal(state.approval.approvedDraft, DRAFT);
  assert.deepEqual(state.approval.approvedAnswers, [['How soon can you start?', ANSWER]], 'with his answer in it');

  assert.deepEqual(ctx.copied, { draft: DRAFT, answers: [{ question: 'How soon can you start?', answer: ANSWER }] }, 'he copied exactly that');

  const sent = latestSent(db, ctx.proposalId);
  assert.ok(sent, 'he marked it sent');
  assert.equal(sent.sentBy, 'Dane');
  assert.equal(sent.approvalId, state.approval.id, 'the version he sent is the one approved');

  const card = pipelineCard(db, ctx.proposalId);
  assert.equal(card?.status, 'replied', 'it is on the board where he moved it');
  assert.deepEqual(card.notes.map((n) => n.note), ['They liked the dashboard idea.']);
  assert.equal(card.nextAction, 'Offer two times for a call.');
  const board = buildPipeline(db);
  assert.equal(board.total, 1, 'only the one sent job is on the board');
}

/** The step left a readable line on the Activity page for each thing it did: when (Mountain time), who and what. */
function assertStepLogged(ctx, step, seenId) {
  const fresh = activityLines(ctx.db()).filter((l) => l.id > seenId);
  const kinds = new Set(listActivity(ctx.db()).filter((e) => e.id > seenId).map((e) => e.kind));
  for (const kind of step.leaves) assert.ok(kinds.has(kind), `the "${step.name}" step leaves a "${kind}" line on the Activity page`);
  for (const l of fresh) {
    assert.match(l.when, /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M MT$/, `"${l.what}" says when, in Mountain time`);
    assert.ok(['You', 'The AI', 'The app'].includes(l.who), `"${l.what}" says who`);
    assert.match(l.what, /^[A-Z].{5,}\.$/, 'and reads as a sentence');
  }
}

/** Run the flow in a fresh, empty app, leaving out the named step, then check where it ended. */
async function runFlow({ skip = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ub-e2e-test-'));
  const saved = Object.fromEntries(['UB_DATA_DIR', 'APP_PASSWORD', 'APP_SESSION_SECRET', 'ANTHROPIC_API_KEY'].map((k) => [k, process.env[k]]));
  process.env.UB_DATA_DIR = dir;
  process.env.APP_PASSWORD = PASSWORD;
  process.env.APP_SESSION_SECRET = 'made-up-e2e-session-secret';
  delete process.env.ANTHROPIC_API_KEY; // a slip past the fakes would fail with "no key", never reach the API
  const claude = fakeClaude();
  useAiDepsForTests(claude.deps);
  useDraftDepsForTests(claude.deps);
  const opened = [];
  const ctx = {
    cookie: null,
    // A fresh connection per read, the way a page load would see it.
    db() {
      const db = openDatabase(join(dir, 'app.sqlite'));
      opened.push(db);
      return db;
    },
  };
  try {
    const setup = openDatabase(join(dir, 'app.sqlite'));
    runMigrations(setup);
    setup.close();
    for (const step of STEPS) {
      if (step.name === skip) continue;
      const seen = listActivity(ctx.db())[0]?.id ?? 0;
      await step.run(ctx);
      assertStepLogged(ctx, step, seen);
    }
    assertFlowFinished(ctx);
    return { claude, ctx, activity: ctx.db().prepare('SELECT * FROM activity_event').all() };
  } finally {
    for (const db of opened) if (db.isOpen) db.close();
    useAiDepsForTests(null);
    useDraftDepsForTests(null);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('§13.15: the whole first version, from pasting a job to tracking it after it was sent', async () => {
  const { claude } = await runFlow();
  // One AI call per pasted job to read it, and one to write the draft: all to the Claude API, all faked.
  assert.deepEqual(
    claude.sent.map((s) => s.model),
    [EXTRACT_MODEL, EXTRACT_MODEL, EXTRACT_MODEL, DRAFT_MODEL],
  );
  assert.ok(claude.sent.every((s) => s.url === ANTHROPIC_URL), 'no request is pointed anywhere but the Claude API');
  assert.ok(claude.sent.every((s) => s.headers['x-api-key'] === FAKE_KEY), 'and only ever with the fake key');
});

test('the activity log of the whole flow holds no password, session cookie or AI key', async () => {
  const { ctx, activity } = await runFlow();
  assert.ok(activity.length >= STEPS.length, 'every step wrote to it');
  const all = JSON.stringify(activity);
  for (const [what, secret] of [
    ['the app password', PASSWORD],
    ['the session key', 'made-up-e2e-session-secret'],
    ['the session cookie', ctx.cookie],
    ['the AI key', FAKE_KEY],
  ]) {
    assert.ok(secret && secret.length > 8, `${what} is known to the test`);
    assert.ok(!all.includes(secret), `${what} is not in the activity log`);
    assert.ok(!all.includes(decodeURIComponent(secret)), `${what} is not in it decoded either`);
  }
  assert.doesNotMatch(all, /sk-ant-/, 'nothing shaped like a Claude key');
});

for (const step of STEPS) {
  test(`the flow fails when the "${step.name}" step is left out`, async () => {
    await assert.rejects(runFlow({ skip: step.name }), assert.AssertionError);
  });
}

test('a signed-out click is refused at the gate and reaches no route', async () => {
  const res = await click({ cookie: null }, '/api/approvals', () => assert.fail('the route ran'), { proposal: '1' });
  assert.equal(res.status, 401);
});
