/**
 * AI metering: every model call records what it cost, in one table
 * (`ai_usage`, db/migrations/003).
 *
 * Copied from StarCaster's lib/aiUsage.js (mentor24-maker/starcaster at
 * b7b42998, November 19, 2026; development plan C12 and D5), trimmed to
 * Anthropic. StarCaster writes to a hosted log table; this app writes to its
 * own SQLite file and prices the call as it records it (lib/ai/pricing.ts).
 *
 * Kept from StarCaster:
 *  - **Cache tokens are counted.** They bill at a different rate, not at zero.
 *  - **No usage block means nothing to record**, which is different from a
 *    real zero.
 *  - **Never throws.** A metering failure must not fail the save Dane was
 *    making; it is said on the server's log instead (without the key, which
 *    never reaches this module).
 */

import type { DatabaseSync } from 'node:sqlite';
import { modelKey, priceCall } from './pricing.ts';

export type Usage = { promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number };

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Anthropic's usage block in one shape, or null when the reply has none. */
export function extractUsage(body: unknown): Usage | null {
  if (!body || typeof body !== 'object') return null;
  const u = (body as { usage?: unknown }).usage as Record<string, unknown> | undefined;
  if (!u || typeof u !== 'object') return null;
  const prompt = num(u.input_tokens);
  const completion = num(u.output_tokens);
  const cached = num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
  // Anthropic reports no total; cache tokens are billed on top of input.
  return { promptTokens: prompt, completionTokens: completion, cachedTokens: cached, totalTokens: prompt + completion + cached };
}

export type RecordArgs = {
  provider: string;
  model: string;
  /** Which part of the app spent this, e.g. 'job_extract'. */
  feature: string;
  usage: Usage | null;
  opportunityId?: number | null;
};

/** Record one call. Resolves to whether a row was written; never throws. */
export function recordAiUsage(db: DatabaseSync, { provider, model, feature, usage, opportunityId }: RecordArgs): { recorded: boolean } {
  try {
    if (!usage) return { recorded: false };
    const price = priceCall({ provider, model, ...usage });
    db.prepare(
      `INSERT INTO ai_usage (feature, provider, model, prompt_tokens, completion_tokens, cached_tokens, priced, cost_usd, unpriced_reason, opportunity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      feature || 'unknown',
      provider,
      modelKey(model) || 'unknown',
      usage.promptTokens,
      usage.completionTokens,
      usage.cachedTokens,
      price.priced ? 1 : 0,
      price.costUsd,
      price.priced ? null : price.reason,
      opportunityId ?? null,
    );
    return { recorded: true };
  } catch (err) {
    console.warn('[ai usage] could not record a call:', (err as Error).message);
    return { recorded: false };
  }
}

export type SpendSummary = {
  calls: number;
  pricedCalls: number;
  unpricedCalls: number;
  /** The total of the priced calls only. */
  costUsd: number;
  /** The models whose calls are not in costUsd, for the page to name. */
  unpricedModels: string[];
};

/** The running total across every recorded call. */
export function aiSpendSummary(db: DatabaseSync): SpendSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(priced), 0) AS priced, COALESCE(SUM(cost_usd), 0) AS cost FROM ai_usage`,
    )
    .get() as { calls: number; priced: number; cost: number };
  const models = db
    .prepare(`SELECT DISTINCT model FROM ai_usage WHERE priced = 0 ORDER BY model`)
    .all()
    .map((r) => String((r as { model: string }).model));
  const calls = Number(row.calls);
  const priced = Number(row.priced);
  return { calls, pricedCalls: priced, unpricedCalls: calls - priced, costUsd: Number(row.cost), unpricedModels: models };
}

/** The summary in plain words, the way the home page shows it. */
export function spendLine(s: SpendSummary): string {
  if (s.calls === 0) return 'AI spend so far: $0.00 (no AI calls yet).';
  const dollars = s.costUsd < 0.01 && s.costUsd > 0 ? `$${s.costUsd.toFixed(4)}` : `$${s.costUsd.toFixed(2)}`;
  const calls = (n: number) => `${n} call${n === 1 ? '' : 's'}`;
  if (s.unpricedCalls === 0) return `AI spend so far: ${dollars} across ${calls(s.calls)}.`;
  return (
    `AI spend so far: ${dollars} across ${calls(s.pricedCalls)}, plus ${calls(s.unpricedCalls)} not priced ` +
    `(${s.unpricedModels.join(', ')} has no price on record), so the real total is higher.`
  );
}
