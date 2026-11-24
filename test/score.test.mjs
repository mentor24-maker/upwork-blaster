import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, runMigrations } from '../lib/db.ts';
import { getJob, saveJob } from '../lib/jobs.ts';
import { savePreferences, DEFAULT_SETTINGS, DEFAULT_WEIGHTS } from '../lib/preferences.ts';
import { addEntry } from '../lib/portfolio.ts';
import {
  budgetAmounts,
  evaluateJob,
  findExclusions,
  latestEvaluation,
  latestEvaluations,
  NEUTRAL,
  rankEvaluations,
  scoreJob,
  scoreJobAndRecord,
  SCORER_VERSION,
} from '../lib/score.ts';

// Made-up jobs and preferences for the tests only: no real client text.
const settings = (over = {}) => ({
  ...DEFAULT_SETTINGS,
  themes: ['Dashboards', 'Custom web applications'],
  requiredTech: ['Next.js', 'TypeScript'],
  unsupportedTech: ['WordPress'],
  exclusions: ['The post forbids AI tools'],
  weights: DEFAULT_WEIGHTS,
  ...over,
});

let nextId = 1;
const job = (over = {}) => ({
  id: nextId++,
  url: `https://example.test/job/${nextId}`,
  title: 'Sales dashboard for a small team',
  description:
    'We need a custom web application: a dashboard in Next.js and TypeScript.\n' +
    '- Login for five users\n- Charts of weekly sales\n- Export to CSV\n' +
    'Deliverables: the working app and its source. Ongoing maintenance likely.',
  budget: '$4,000',
  jobType: 'fixed',
  postedAt: null,
  client: 'Payment verified, 4.9 of 5, $25k spent, 12 hires',
  connectsCost: 16,
  createdAt: '2026-11-24T00:00:00.000Z',
  extractedAt: null,
  extractionProblem: null,
  ...over,
});

const freshDb = () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
};
const dim = (ev, key) => ev.dimensions.find((d) => d.key === key);

// ---- the hand-off's acceptance test: exclusions kept apart from the score

test('an excluded job is never ranked above an allowed one, and names its exclusion', () => {
  const s = settings();
  // The excluded job is a better match on every dimension than the allowed one...
  const excluded = evaluateJob(job({ description: job().description + '\nBuilt on WordPress.' }), s, 3, []);
  const weak = evaluateJob(
    job({ title: 'Quick fix', description: 'Fix a typo.', budget: '$50', client: null }),
    s,
    3,
    [],
  );

  assert.equal(excluded.excluded, true);
  assert.equal(excluded.score, null, 'an excluded job has no score at all');
  assert.deepEqual(
    excluded.exclusions.map((e) => [e.kind, e.rule]),
    [['unsupported-tech', 'WordPress']],
    'it says which exclusion it met',
  );
  assert.match(excluded.exclusions[0].evidence, /WordPress/, 'and where in the post');

  assert.equal(weak.excluded, false);
  assert.ok(weak.score < 50, `the allowed job is a weak one (scored ${weak.score})`);

  // ...yet whatever order they come in, it is never ranked, let alone above it.
  for (const order of [[excluded, weak], [weak, excluded]]) {
    const { ranked, setAside } = rankEvaluations(order);
    assert.deepEqual(ranked.map((e) => e.opportunityId), [weak.opportunityId]);
    assert.equal(ranked[0].rank, 1);
    assert.deepEqual(setAside.map((e) => e.opportunityId), [excluded.opportunityId]);
  }
});

test('a post that forbids AI meets an AI exclusion; one that does not, does not', () => {
  const s = settings();
  const banned = findExclusions({ title: 'Blog posts', description: 'Writers only. No AI tools of any kind.' }, s);
  assert.deepEqual(banned.exclusions.map((e) => e.rule), ['The post forbids AI tools']);
  const generated = findExclusions({ title: 'X', description: 'AI-generated proposals will be rejected.' }, s);
  assert.equal(generated.exclusions.length, 1);
  const fine = findExclusions({ title: 'Add an AI chat helper', description: 'Use the Claude API.' }, s);
  assert.deepEqual(fine.exclusions, []);
});

test('a "no" or "ban" that does not govern the AI word is not a ban', () => {
  const s = settings({ exclusions: ['Posts that forbid AI tools'] });
  for (const description of [
    'Our banking platform needs an AI assistant.',
    'We are not a big team, but we build AI products and need a dashboard.',
    'No prior experience needed with GPT, we will train you.',
  ]) {
    const r = findExclusions({ title: 'Dashboard', description }, s);
    assert.deepEqual(r.exclusions, [], description);
    assert.deepEqual(r.unchecked, [], description);
  }
  for (const description of [
    'No AI please.',
    'Please do not use ChatGPT for this.',
    'Write it without AI.',
    'Use of AI tools is strictly prohibited.',
    'AI-generated work will not be accepted.',
  ]) {
    const r = findExclusions({ title: 'Blog posts', description }, s);
    assert.equal(r.exclusions.length, 1, description);
  }
});

test('a rule that mentions AI without forbidding it is flagged, never quietly passed', () => {
  const s = settings({ exclusions: ['AI chatbot / LLM wrapper projects'] });
  const r = findExclusions({ title: 'Support bot', description: 'Build a support bot on top of a model API.' }, s);
  assert.deepEqual(r.exclusions, []);
  assert.deepEqual(r.unchecked, ['AI chatbot / LLM wrapper projects']);
});

test('an exclusion rule the app cannot check is flagged for Dane, never quietly passed or guessed', () => {
  const s = settings({ exclusions: ['Impossible deadline'] });
  const ev = evaluateJob(job(), s, 1, []);
  assert.equal(ev.excluded, false);
  assert.ok(ev.flags.some((f) => f.includes('Impossible deadline') && /could not check/.test(f)), ev.flags.join('\n'));
  // The rule's own words in the post do exclude it.
  const met = evaluateJob(job({ description: 'An impossible deadline: tomorrow.' }), s, 1, []);
  assert.equal(met.excluded, true);
  assert.equal(met.exclusions[0].rule, 'Impossible deadline');
});

// ---- the hand-off's §13.2: unknown facts stay unknown

test('an unknown fact scores neutral, is listed as unknown, and lowers confidence', () => {
  const s = settings();
  const known = evaluateJob(job(), s, 1, []);
  const unknown = evaluateJob(job({ budget: null, jobType: null, client: null }), s, 1, []);

  for (const key of ['budget', 'client']) {
    assert.equal(dim(unknown, key).score, NEUTRAL, `${key} scores neutral when unknown`);
    assert.equal(dim(unknown, key).confidence, 'low');
    assert.deepEqual(dim(unknown, key).evidence, [], `nothing is invented about the ${key}`);
    assert.notEqual(dim(known, key).score, NEUTRAL, `${key} is scored when known`);
  }
  assert.ok(unknown.unknowns.includes('budget'));
  assert.ok(unknown.unknowns.includes('client history'));
  assert.ok(!known.unknowns.includes('budget'));
  assert.ok(!known.unknowns.includes('client history'));
  assert.ok(
    ['low', 'medium', 'high'].indexOf(unknown.confidence) < ['low', 'medium', 'high'].indexOf(known.confidence),
    `confidence drops: ${known.confidence} -> ${unknown.confidence}`,
  );
});

test('a budget without its job type, or a client with no signals, is neutral rather than guessed', () => {
  const ev = evaluateJob(job({ jobType: null, budget: '$2,000', client: 'Located in a large city' }), settings(), 1, []);
  assert.equal(dim(ev, 'budget').score, NEUTRAL);
  assert.ok(ev.unknowns.includes('whether it is fixed price or hourly'));
  assert.equal(dim(ev, 'client').score, NEUTRAL);
  assert.ok(ev.unknowns.some((u) => u.startsWith('client reliability')));
  // An hourly rate in the budget text says the type by itself.
  const hourly = evaluateJob(job({ jobType: null, budget: '$90/hr' }), settings(), 1, []);
  assert.equal(dim(hourly, 'budget').score, 80);
});

test('a new client or unverified payment is a flag, not an exclusion', () => {
  const ev = evaluateJob(job({ client: 'Payment method not verified, 0 hires, $0 spent' }), settings(), 1, []);
  assert.equal(ev.excluded, false);
  assert.ok(ev.flags.some((f) => /payment method is not verified/.test(f)));
  assert.ok(ev.flags.some((f) => /new client/.test(f)));
});

// ---- the dimensions read their evidence

test('each of the five dimensions records its weight, evidence and confidence', () => {
  const portfolio = [
    { id: 1, project: 'Example CRM', status: 'delivered', features: 'Charts of weekly sales, CSV export', links: [], approvedForUse: true },
    { id: 2, project: 'Planned thing', status: 'planned', features: 'Login for five users', links: [], approvedForUse: true },
  ];
  const ev = evaluateJob(job(), settings(), 7, portfolio);
  assert.deepEqual(ev.dimensions.map((d) => [d.key, d.weight]), [
    ['fit', 30],
    ['budget', 25],
    ['clarity', 20],
    ['client', 15],
    ['interest', 10],
  ]);
  const fit = dim(ev, 'fit');
  assert.ok(fit.evidence.some((e) => /Dashboards/.test(e) && /Custom web applications/.test(e)), fit.evidence.join('\n'));
  assert.ok(fit.evidence.some((e) => /Next\.js, TypeScript/.test(e)));
  assert.ok(fit.evidence.some((e) => /delivered project Example CRM/.test(e)));
  assert.ok(!fit.evidence.some((e) => /Planned thing/.test(e)), 'a planned project is never evidence');
  assert.equal(fit.confidence, 'high');
  assert.ok(dim(ev, 'client').evidence.includes('Payment method verified'));
  assert.ok(dim(ev, 'interest').evidence[0].startsWith('Mentions continuing work'));
  assert.equal(ev.preferencesVersion, 7);
  assert.equal(ev.scorerVersion, SCORER_VERSION);
  assert.ok(ev.score > 70, `a strong job scores high (${ev.score})`);
});

test('the score follows the weights, and the same inputs always give the same score', () => {
  const j = job({ client: null });
  const a = evaluateJob(j, settings(), 1, []);
  assert.deepEqual(evaluateJob(j, settings(), 1, []), a);
  const clientOnly = evaluateJob(j, settings({ weights: { fit: 0, budget: 0, clarity: 0, client: 100, interest: 0 } }), 2, []);
  assert.equal(clientOnly.score, NEUTRAL, 'only the (unknown) client counts, so the score is neutral');
});

test('budget amounts are read from the ways Upwork writes them', () => {
  assert.deepEqual(budgetAmounts('$1,500'), [1500]);
  assert.deepEqual(budgetAmounts('$40.00 - $60.00 /hr'), [40, 60]);
  assert.deepEqual(budgetAmounts('Up to $2k'), [2000]);
  assert.deepEqual(budgetAmounts('$40-60/hr'), [40, 60]);
  assert.deepEqual(budgetAmounts('Not sure yet'), []);
});

// ---- saved in the evaluation table with the version used

test('a scored job is saved with its reasons and the preferences version in force', () => {
  const db = freshDb();
  const id1 = saveJob(db, { ...job(), url: 'https://www.upwork.com/jobs/~01aaaaaaaa' });
  const id2 = saveJob(db, { ...job({ description: 'A WordPress theme tweak.' }), url: 'https://www.upwork.com/jobs/~01bbbbbbbb' });
  assert.ok(id1.ok && id2.ok);

  const none = scoreJob(db, id1.id);
  assert.equal(none.preferencesVersion, null, 'before any save, the starting preferences are used and say so');

  const v = savePreferences(db, settings());
  const first = scoreJob(db, id1.id);
  const second = scoreJob(db, id2.id);
  assert.equal(first.preferencesVersion, v);
  assert.equal(first.excluded, false);
  assert.equal(typeof first.score, 'number');
  assert.equal(first.dimensions.length, 5);
  assert.equal(second.excluded, true);
  assert.equal(second.score, null);
  assert.equal(second.exclusions[0].rule, 'WordPress');

  assert.deepEqual(latestEvaluation(db, id1.id), first, 'the newest score is the one in force');
  assert.deepEqual(latestEvaluations(db).map((e) => e.id).sort(), [first.id, second.id].sort());
  assert.equal(scoreJob(db, 9999), undefined);

  const { ranked, setAside } = rankEvaluations(latestEvaluations(db));
  assert.deepEqual(ranked.map((e) => e.opportunityId), [id1.id]);
  assert.deepEqual(setAside.map((e) => e.opportunityId), [id2.id]);
});

test('the table refuses a score on an excluded job, and an allowed job without one', () => {
  const db = freshDb();
  const j = saveJob(db, { ...job(), url: 'https://www.upwork.com/jobs/~01cccccccc' });
  const insert = (excluded, score) =>
    db
      .prepare(
        `INSERT INTO evaluation (opportunity_id, scorer_version, excluded, score, confidence, dimensions) VALUES (?, 'rules-1', ?, ?, 'low', '[]')`,
      )
      .run(j.id, excluded, score);
  assert.throws(() => insert(1, 80), /CHECK/);
  assert.throws(() => insert(0, null), /CHECK/);
  insert(1, null);
  insert(0, 55);
});

test('a portfolio entry not approved for use never counts as evidence', () => {
  const db = freshDb();
  addEntry(db, { project: 'Hidden', status: 'delivered', features: 'Charts of weekly sales', links: [], approvedForUse: false });
  const j = saveJob(db, { ...job(), url: 'https://www.upwork.com/jobs/~01dddddddd' });
  const ev = scoreJob(db, j.id);
  assert.ok(!dim(ev, 'fit').evidence.some((e) => /Hidden/.test(e)));
});

test('a client\'s hire count is read with its thousands separator', () => {
  const s = settings();
  const big = dim(evaluateJob(job({ client: 'Payment verified, 2,000 hires' }), s, 1, []), 'client');
  assert.ok(big.evidence.some((l) => l.startsWith('2000 hires')), big.evidence.join('\n'));
  const ev = evaluateJob(job({ client: 'Payment verified, 2,000 hires' }), s, 1, []);
  assert.ok(!ev.flags.some((f) => f.includes('no hires')), ev.flags.join('\n'));
  const odd = dim(evaluateJob(job({ client: '1,005 hires' }), s, 1, []), 'client');
  assert.ok(odd.evidence.some((l) => l.startsWith('1005 hires')), odd.evidence.join('\n'));
});

// ---- review round 2: posts that read like a ban word by word, but are not

test('"no AI experience needed" and a client saying they do not use AI yet are not bans', () => {
  const s = settings({ exclusions: ['Posts that forbid AI tools'] });
  for (const description of [
    'No AI experience required, we will teach you.',
    'Zero AI knowledge needed.',
    'We do not use AI yet and want you to add ChatGPT to our CRM.',
    'Our site does not use AI today; we want a chatbot.',
    "We don't use GPT so far, but want to start.",
  ]) {
    const r = findExclusions({ title: 'Add AI to our CRM', description }, s);
    assert.deepEqual(r.exclusions, [], description);
  }
  // Real bans still exclude, including one after a self-description.
  for (const description of [
    'We ask that you do not use AI for this.',
    'Please do not use ChatGPT. We review every line.',
    'We do not use AI yet. Do not use AI in your proposal either.',
    'No AI.',
  ]) {
    assert.equal(findExclusions({ title: 'Blog posts', description }, s).exclusions.length, 1, description);
  }
});

test('a tech name that is also an English word only excludes when it is the technology', () => {
  const s = settings({ unsupportedTech: ['Go', 'Swift'] });
  for (const description of [
    'We are ready to go live next week.',
    'Swift delivery appreciated.',
    'Go ahead and send your best proposal.',
  ]) {
    assert.deepEqual(findExclusions({ title: 'Dashboard', description }, s).exclusions, [], description);
  }
  for (const [description, rule] of [
    ['The backend is written in Go.', 'Go'],
    ['Swift developer needed for our iOS app.', 'Swift'],
    ['We use Swift and SwiftUI.', 'Swift'],
  ]) {
    const r = findExclusions({ title: 'Dashboard', description }, s);
    assert.deepEqual(r.exclusions.map((e) => e.rule), [rule], description);
  }
  // A name that is not a word still matches in any case.
  const wp = findExclusions({ title: 'Fix', description: 'A wordpress plugin.' }, settings());
  assert.deepEqual(wp.exclusions.map((e) => e.rule), ['WordPress']);
});

test('"Clients who don\'t allow AI" is read as a ban rule', () => {
  const s = settings({ exclusions: ["Clients who don't allow AI"] });
  const r = findExclusions({ title: 'Blog', description: 'Use of AI is strictly prohibited.' }, s);
  assert.equal(r.exclusions.length, 1);
  assert.deepEqual(r.unchecked, []);
  const n = findExclusions({ title: 'Blog', description: 'Write it without AI.' }, settings({ exclusions: ['No AI posts'] }));
  assert.equal(n.exclusions.length, 1);
});

test('a theme\'s words must appear together in one sentence, as the same words', () => {
  const s = settings({ themes: ['Custom web applications'], requiredTech: [] });
  const scattered = evaluateJob(
    job({ description: 'Our customer list is long.\n\nThe website is old.\n\nEach applicant gets a call.' }),
    s,
    1,
    [],
  );
  assert.ok(!dim(scattered, 'fit').evidence.some((e) => /Matches your theme/.test(e)), dim(scattered, 'fit').evidence.join('\n'));
  const together = evaluateJob(job({ description: 'We need a custom application for the web, for our team.' }), s, 1, []);
  assert.ok(dim(together, 'fit').evidence.some((e) => /Custom web applications/.test(e)), dim(together, 'fit').evidence.join('\n'));
});

test('a clarity cue counts once, by its root', () => {
  const s = settings();
  const once = dim(evaluateJob(job({ description: 'One feature. Two features. Three features.' }), s, 1, []), 'clarity');
  const named = once.evidence.find((e) => e.startsWith('Names'));
  assert.equal(named, 'Names feature');
});

test('a scoring failure is recorded on the job, and cleared once it scores', () => {
  const db = freshDb();
  const j = saveJob(db, { ...job(), url: 'https://www.upwork.com/jobs/~01eeeeeeee' });
  db.exec('ALTER TABLE evaluation RENAME TO evaluation_gone');
  const problem = scoreJobAndRecord(db, j.id);
  assert.match(problem, /evaluation/);
  assert.equal(getJob(db, j.id).scoringProblem, problem, 'the job says why it is not scored');
  db.exec('ALTER TABLE evaluation_gone RENAME TO evaluation');
  assert.equal(scoreJobAndRecord(db, j.id), null);
  assert.equal(getJob(db, j.id).scoringProblem, null);
  assert.ok(latestEvaluation(db, j.id));
});
