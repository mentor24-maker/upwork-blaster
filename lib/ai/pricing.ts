/**
 * What an AI call cost, in dollars.
 *
 * Copied from StarCaster's lib/aiPricing.js (mentor24-maker/starcaster at
 * b7b42998, November 19, 2026; development plan C12 and D5), trimmed to
 * Anthropic, the one provider this app uses, and turned into TypeScript.
 *
 * Three rules, kept from StarCaster, and they are the whole design:
 *
 *  1. **An unknown model is never $0.** It is `priced: false`, and the page
 *     must say so. A total that silently leaves out a call is worse than no
 *     total, because it looks complete.
 *  2. **Rates are dated and sourced.** Model prices move; a stale rate that
 *     looks authoritative is the same failure, only slower.
 *  3. **Estimates round up, never down.** Where two rates cannot be told
 *     apart, the higher one is charged (cached tokens, below).
 *
 * These are LIST rates for direct API use.
 */

const MILLION = 1_000_000;

type Rate = { input: number; output: number; longContext?: { above: number; input: number; output: number } };

/**
 * Anthropic list pricing, dollars per million tokens. Source: Anthropic's
 * pricing page (platform.claude.com/docs/en/about-claude/pricing), as
 * StarCaster checked it on 2026-10-30.
 *
 * `longContext` is a second tier for prompts over `above` input tokens.
 */
export const ANTHROPIC_RATES: Readonly<Record<string, Rate>> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    longContext: { above: 100_000, input: 0.5, output: 2.5 },
  },
};

/** The date the table above was last checked. */
export const RATES_CHECKED = '2026-10-30';

export type PriceInput = {
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Cache creation and cache reads, combined. */
  cachedTokens?: number;
};

export type Price =
  | { priced: true; costUsd: number; reason: ''; note: string }
  | { priced: false; costUsd: null; reason: string; note: '' };

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** One model is one rate however it is spelled ("anthropic/claude-..." too). */
export function modelKey(model: string): string {
  return String(model || '')
    .trim()
    .replace(/^anthropic\//, '');
}

/**
 * Price one call. Unlike StarCaster's, an unpriced call's cost is `null`,
 * not 0, so no caller can add it into a total by mistake.
 */
export function priceCall({ provider, model, promptTokens, completionTokens, cachedTokens }: PriceInput): Price {
  if (String(provider || '').trim().toLowerCase() !== 'anthropic') {
    return { priced: false, costUsd: null, reason: `no rate table for provider "${provider}"`, note: '' };
  }
  const entry = ANTHROPIC_RATES[modelKey(model)];
  if (!entry) {
    return { priced: false, costUsd: null, reason: `no rate for model "${model}" (add it to lib/ai/pricing.ts)`, note: '' };
  }
  const input = num(promptTokens);
  const output = num(completionTokens);
  const cached = num(cachedTokens);
  const long = entry.longContext && input > entry.longContext.above ? entry.longContext : null;
  const rate = long ?? entry;
  // Cache writes bill at 1.25x input and reads at about 0.1x, but only their
  // sum is recorded, so the higher rate is charged (rule 3).
  const costUsd = (input * rate.input + output * rate.output + cached * rate.input * 1.25) / MILLION;
  return { priced: true, costUsd, reason: '', note: long ? 'long-prompt rate' : '' };
}
