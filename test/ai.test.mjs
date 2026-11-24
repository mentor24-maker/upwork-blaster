// The AI door, its meter and its prices (lib/ai/, copied from StarCaster).
// Every reply here is fake: no test calls the real API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, runMigrations } from '../lib/db.ts';
import { priceCall } from '../lib/ai/pricing.ts';
import { aiSpendSummary, extractUsage, recordAiUsage, spendLine } from '../lib/ai/usage.ts';
import { buildRequest, generate, parseJsonReply } from '../lib/ai/client.ts';

const MILLION = 1_000_000;
const FAKE_KEY = 'sk-ant-fake-test-key-0000';

const freshDb = () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
};

/** A fake fetch that answers once with `body` and remembers what it was sent. */
function fakeFetch(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { impl, calls };
}

const reply = (text, model = 'claude-haiku-5-5', usage = { input_tokens: 1000, output_tokens: 200 }) => ({
  model,
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage,
});

// ── prices ────────────────────────────────────────────────────────────────

test('a known model is priced at its list rate', () => {
  const p = priceCall({ provider: 'anthropic', model: 'claude-opus-5', promptTokens: MILLION, completionTokens: MILLION });
  assert.equal(p.priced, true);
  assert.equal(p.costUsd, 30);
  const haiku = priceCall({ provider: 'anthropic', model: 'anthropic/claude-haiku-5-5', promptTokens: 100_000, completionTokens: MILLION });
  assert.equal(haiku.costUsd.toFixed(6), (0.01 + 0.5).toFixed(6), 'a provider prefix is the same model');
  const long = priceCall({ provider: 'anthropic', model: 'claude-haiku-5-5', promptTokens: 100_001, completionTokens: 0 });
  assert.equal(long.note, 'long-prompt rate');
});

test('cached tokens are charged at the higher cache-write rate', () => {
  const p = priceCall({ provider: 'anthropic', model: 'claude-opus-5', cachedTokens: MILLION });
  assert.equal(p.costUsd, 6.25);
});

test('an unknown model is "not priced", never $0', () => {
  const p = priceCall({ provider: 'anthropic', model: 'claude-something-unreleased', promptTokens: MILLION });
  assert.equal(p.priced, false);
  assert.equal(p.costUsd, null, 'null, so nothing can add it into a total as zero');
  assert.match(p.reason, /no rate for model/);
  assert.equal(priceCall({ provider: 'openai', model: 'x', promptTokens: 1 }).priced, false);
});

// ── the meter ─────────────────────────────────────────────────────────────

test('usage is read from a reply, cache tokens included, and a reply without one records nothing', () => {
  assert.deepEqual(
    extractUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 } }),
    { promptTokens: 10, completionTokens: 5, cachedTokens: 5, totalTokens: 20 },
  );
  assert.equal(extractUsage({}), null);
  assert.equal(extractUsage('error text'), null);
  const db = freshDb();
  assert.deepEqual(recordAiUsage(db, { provider: 'anthropic', model: 'claude-haiku-5-5', feature: 't', usage: null }), { recorded: false });
  assert.equal(aiSpendSummary(db).calls, 0);
  db.close();
});

test('each call is recorded with its cost, and an unpriced model shows as "not priced", not zero', () => {
  const db = freshDb();
  assert.equal(spendLine(aiSpendSummary(db)), 'AI spend so far: $0.00 (no AI calls yet).');

  const usage = { promptTokens: MILLION, completionTokens: 0, cachedTokens: 0, totalTokens: MILLION };
  recordAiUsage(db, { provider: 'anthropic', model: 'claude-sonnet-5-5', feature: 'job_extract', usage });
  const row = db.prepare('SELECT * FROM ai_usage').get();
  assert.equal(row.priced, 1);
  assert.equal(row.cost_usd, 2);
  assert.equal(row.feature, 'job_extract');
  assert.equal(spendLine(aiSpendSummary(db)), 'AI spend so far: $2.00 across 1 call.');

  recordAiUsage(db, { provider: 'anthropic', model: 'claude-mystery-9', feature: 'job_extract', usage });
  const unpriced = db.prepare("SELECT * FROM ai_usage WHERE model = 'claude-mystery-9'").get();
  assert.equal(unpriced.priced, 0);
  assert.equal(unpriced.cost_usd, null, 'stored as unknown, not as $0');
  assert.match(unpriced.unpriced_reason, /no rate for model/);

  const s = aiSpendSummary(db);
  assert.deepEqual(s, { calls: 2, pricedCalls: 1, unpricedCalls: 1, costUsd: 2, unpricedModels: ['claude-mystery-9'] });
  const line = spendLine(s);
  assert.match(line, /1 call not priced/);
  assert.match(line, /claude-mystery-9/);
  assert.match(line, /real total is higher/);

  // The table itself refuses an unpriced row that claims a cost.
  assert.throws(
    () => db.prepare("INSERT INTO ai_usage (feature, provider, model, priced, cost_usd) VALUES ('f', 'anthropic', 'm', 0, 0)").run(),
    /CHECK/,
  );
  db.close();
});

test('a tiny cost is shown to the hundredth of a cent, not rounded to $0.00', () => {
  assert.equal(
    spendLine({ calls: 1, pricedCalls: 1, unpricedCalls: 0, costUsd: 0.0002, unpricedModels: [] }),
    'AI spend so far: $0.0002 across 1 call.',
  );
});

// ── the door ──────────────────────────────────────────────────────────────

test('the request carries the key only in its header', () => {
  const req = buildRequest({ feature: 'f', model: 'claude-haiku-5-5', system: 'S', messages: 'hello', json: true }, FAKE_KEY);
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['x-api-key'], FAKE_KEY);
  assert.ok(!JSON.stringify(req.body).includes(FAKE_KEY));
  assert.deepEqual(req.body.messages, [{ role: 'user', content: 'hello' }]);
  assert.match(req.body.system, /single JSON object/);
});

test('a reply is read, parsed as JSON and metered under the model that answered', async () => {
  const f = fakeFetch(reply('```json\n{"a":1}\n```', 'claude-haiku-5-5'));
  const metered = [];
  const res = await generate(
    { feature: 'job_extract', model: 'claude-haiku-5-5', messages: 'x', json: true },
    { fetchImpl: f.impl, getKey: () => FAKE_KEY, recordUsage: (a) => metered.push(a) },
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.json, { a: 1 });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(metered, [
    { provider: 'anthropic', model: 'claude-haiku-5-5', feature: 'job_extract', usage: { promptTokens: 1000, completionTokens: 200, cachedTokens: 0, totalTokens: 1200 } },
  ]);
  assert.deepEqual(parseJsonReply('not json').ok, false);
});

test('with no key nothing is sent, and the reason says so plainly', async () => {
  const f = fakeFetch(reply('{}'));
  const res = await generate({ feature: 'f', model: 'm', messages: 'x' }, { fetchImpl: f.impl, getKey: () => '', recordUsage: () => {} });
  assert.deepEqual(res, { ok: false, code: 'no_key', error: 'the AI is not set up yet: no ANTHROPIC_API_KEY is set' });
  assert.equal(f.calls.length, 0);
});

test('the key never appears in a failure, even when the reply echoes it back', async () => {
  const deps = (impl) => ({ fetchImpl: impl, getKey: () => FAKE_KEY, recordUsage: () => {} });
  const refused = await generate(
    { feature: 'f', model: 'm', messages: 'x' },
    deps(fakeFetch({ error: { message: `invalid x-api-key ${FAKE_KEY}` } }, 401).impl),
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'provider_error');
  assert.equal(refused.status, 401);
  assert.ok(!refused.error.includes(FAKE_KEY), refused.error);
  assert.match(refused.error, /\[key removed\]/);

  const down = await generate({ feature: 'f', model: 'm', messages: 'x' }, deps(async () => { throw new Error(`socket closed ${FAKE_KEY}`); }));
  assert.equal(down.code, 'no_answer');
  assert.ok(!down.error.includes(FAKE_KEY));

  const notJson = await generate({ feature: 'f', model: 'm', messages: 'x', json: true }, deps(fakeFetch(reply('sorry, no')).impl));
  assert.equal(notJson.code, 'bad_json');
});
