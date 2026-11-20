/**
 * The one door every AI call goes through.
 *
 * Copied from StarCaster's lib/aiClient.js `generate()` (mentor24-maker/
 * starcaster at b7b42998, November 19, 2026; development plan C12 and D5),
 * trimmed to Anthropic: no provider list, no fall-through to another
 * provider's bill, no settings screen. What is kept is the shape: the caller
 * says WHAT it wants (`feature`, `json`), the door makes the request, meters
 * it under the model that actually answered, and hands back a plain result
 * that never throws.
 *
 * The key is `ANTHROPIC_API_KEY`, which Doppler hands the app when it starts
 * (scripts/run_app.sh). It goes into one request header and nowhere else:
 * never into a result, an error, the database or a log.
 *
 * Every dependency (fetch, the key, the meter) can be swapped, so the tests
 * never call the real API.
 */

import type { Usage } from './usage.ts';
import { extractUsage } from './usage.ts';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const KEY_ENV = 'ANTHROPIC_API_KEY';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;

export type Message = { role: 'user' | 'assistant'; content: string };

export type GenerateOptions = {
  /** What is spending, e.g. 'job_extract'; the meter files the call under it. */
  feature: string;
  model: string;
  system?: string;
  messages: string | Message[];
  /** true: ask for one JSON object and parse it. */
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
};

export type GenerateDeps = {
  fetchImpl: typeof fetch;
  getKey: () => string;
  recordUsage: (args: { provider: 'anthropic'; model: string; feature: string; usage: Usage | null }) => void;
};

export type GenerateResult =
  | { ok: true; text: string; json?: unknown; model: string; usage: Usage | null; stopReason: string | null }
  | { ok: false; code: 'no_key' | 'no_answer' | 'provider_error' | 'bad_json'; error: string; status?: number };

const JSON_INSTRUCTION = 'Reply with a single JSON object and nothing else: no prose, no code fences.';

function systemFor(system: string | undefined, json: boolean): string {
  const base = String(system || '').trim();
  if (!json) return base;
  return base ? `${base}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION;
}

function normaliseMessages(messages: string | Message[]): Message[] {
  if (!Array.isArray(messages)) return [{ role: 'user', content: String(messages || '') }];
  return messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
}

/** The request, built without sending it, so a test can read exactly what would go out. */
export function buildRequest(opts: GenerateOptions, key: string) {
  const sys = systemFor(opts.system, Boolean(opts.json));
  const maxTokens = Number.isInteger(opts.maxTokens) && opts.maxTokens! > 0 ? opts.maxTokens! : DEFAULT_MAX_TOKENS;
  return {
    url: ANTHROPIC_URL,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    // No temperature: newer Claude models refuse it with a 400.
    body: { model: opts.model, max_tokens: maxTokens, ...(sys ? { system: sys } : {}), messages: normaliseMessages(opts.messages) },
  };
}

/** The reply's text, why it stopped, and the model that actually ran. */
export function readReply(body: unknown, requestedModel: string) {
  const b = (body && typeof body === 'object' ? body : {}) as { content?: unknown; stop_reason?: unknown; model?: unknown };
  const parts = Array.isArray(b.content) ? b.content : [];
  const text = parts
    .filter((p) => p && typeof p === 'object' && (p as { type?: unknown }).type === 'text')
    .map((p) => String((p as { text?: unknown }).text ?? ''))
    .join('');
  return {
    text,
    stopReason: typeof b.stop_reason === 'string' ? b.stop_reason : null,
    model: typeof b.model === 'string' && b.model ? b.model : requestedModel,
  };
}

/** JSON as asked for: code fences tolerated, anything else refused by name. */
export function parseJsonReply(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function readBodySafe(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageOf(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  const err = (body as { error?: unknown }).error;
  if (typeof err === 'string') return err.slice(0, 300);
  const msg = (err as { message?: unknown } | undefined)?.message ?? (body as { message?: unknown }).message;
  return String(msg ?? '').slice(0, 300);
}

/** Belt and braces: a key echoed back in an error never travels further. */
function scrub(text: string, key: string): string {
  return key ? text.split(key).join('[key removed]') : text;
}

/** The live dependencies: the real fetch and the key from the environment. */
export function liveDeps(recordUsage: GenerateDeps['recordUsage'], env: Record<string, string | undefined> = process.env): GenerateDeps {
  return {
    fetchImpl: (...args) => fetch(...args),
    getKey: () => String(env[KEY_ENV] || '').trim(),
    recordUsage,
  };
}

/** Send one request to Claude. Never throws; every failure comes back with a plain reason. */
export async function generate(opts: GenerateOptions, deps: GenerateDeps): Promise<GenerateResult> {
  const key = deps.getKey();
  if (!key) return { ok: false, code: 'no_key', error: `the AI is not set up yet: no ${KEY_ENV} is set` };
  const json = Boolean(opts.json);
  const timeoutMs = Number.isInteger(opts.timeoutMs) && opts.timeoutMs! > 0 ? opts.timeoutMs! : DEFAULT_TIMEOUT_MS;
  const req = buildRequest(opts, key);

  let res: Response;
  try {
    res = await deps.fetchImpl(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    const why = e && e.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)}s` : String(e?.message || e);
    return { ok: false, code: 'no_answer', error: scrub(`Claude did not answer: ${why}`, key) };
  }
  const body = await readBodySafe(res);
  if (!res.ok) {
    const said = errorMessageOf(body);
    return {
      ok: false,
      code: 'provider_error',
      status: res.status,
      error: scrub(`Claude refused the request (${res.status})${said ? `: ${said}` : ''}`, key),
    };
  }

  const reply = readReply(body, opts.model);
  const usage = extractUsage(body);
  deps.recordUsage({ provider: 'anthropic', model: reply.model, feature: opts.feature || 'unknown', usage });

  if (!json) return { ok: true, text: reply.text, model: reply.model, usage, stopReason: reply.stopReason };
  const parsed = parseJsonReply(reply.text);
  if (!parsed.ok) return { ok: false, code: 'bad_json', error: `Claude answered, but not with JSON (${parsed.error})` };
  return { ok: true, text: reply.text, json: parsed.value, model: reply.model, usage, stopReason: reply.stopReason };
}
