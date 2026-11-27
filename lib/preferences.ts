/**
 * Dane's search preferences and ranking weights (task 2.2, plan C10).
 *
 * Every save is a new version: a new row in the `preferences` table, never an
 * edit of an old one, so a later score (task 2.5) can name the version it
 * used and still explain itself after he changes his mind. The newest version
 * is the one in force.
 *
 * Nothing here imports Next.js, so the tests run it directly under
 * `node --test`. The page's form posts to app/api/preferences/route.ts, which
 * calls `readPreferencesForm` then `savePreferences`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { logActivity } from './activity.ts';

/** The five ranking dimensions of the hand-off's §6, in its order. */
export const WEIGHT_KEYS = ['fit', 'budget', 'clarity', 'client', 'interest'] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export type Weights = Record<WeightKey, number>;

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  fit: 'Fit with Spirality and what it has shown it can do',
  budget: 'Budget against scope and likely human effort',
  clarity: 'Clarity of the problem and deliverables',
  client: 'Evidence the client is reliable',
  interest: 'Your interest and the chance of continuing work',
};

/** The hand-off's starting weights, 30/25/20/15/10. A starting guess for Dane to tune. */
export const DEFAULT_WEIGHTS: Weights = { fit: 30, budget: 25, clarity: 20, client: 15, interest: 10 };

export const LIST_KEYS = ['themes', 'requiredTech', 'unsupportedTech', 'exclusions'] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export type Settings = Record<ListKey, string[]> & { weights: Weights };

export type SavedPreferences = { version: number; settings: Settings; createdAt: string };

/** What a first visit starts from: the hand-off's search themes (§5B) and weights. */
export const DEFAULT_SETTINGS: Settings = {
  themes: [
    'Custom web applications',
    'SaaS MVPs',
    'Business portals',
    'Dashboards',
    'Workflow automation',
    'Integrations',
  ],
  requiredTech: [],
  unsupportedTech: [],
  exclusions: [],
  weights: DEFAULT_WEIGHTS,
};

/** Limits: plenty for real lists, small enough to catch a wrong paste. */
export const MAX_ITEMS = 100;
export const MAX_ITEM_LENGTH = 200;

/** Why the form could not be saved; each has a plain message (preferencesFormMessage). */
export type PreferencesFormError = 'bad-weight' | 'weights-total' | 'too-many' | 'too-long';

const MESSAGES: Record<PreferencesFormError, string> = {
  'bad-weight': 'Each weight is a whole number from 0 to 100. Nothing was saved.',
  'weights-total': 'The five weights must add up to 100. Nothing was saved.',
  'too-many': `A list can hold at most ${MAX_ITEMS} lines. Nothing was saved.`,
  'too-long': `Each line can be at most ${MAX_ITEM_LENGTH} characters. Nothing was saved.`,
};

/**
 * The message for an error code from the address, or null for anything else.
 * For a wrong total, `total` (also from the address) is named when it is a
 * plain number.
 */
export function preferencesFormMessage(
  code: string | string[] | undefined,
  total?: string | string[] | undefined,
): string | null {
  const c = Array.isArray(code) ? code[0] : code;
  if (!c || !Object.hasOwn(MESSAGES, c)) return null;
  const t = Array.isArray(total) ? total[0] : total;
  if (c === 'weights-total' && t && /^\d{1,4}$/.test(t)) {
    return `The five weights add up to ${Number(t)}; they must add up to 100. Nothing was saved.`;
  }
  return MESSAGES[c as PreferencesFormError];
}

type FormLike = { get(name: string): unknown };

const text = (form: FormLike, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

/** One entry per line: trimmed, blanks dropped, repeats (any case) kept once. */
export function readList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const item = line.trim().replace(/\s+/g, ' ');
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    out.push(item);
  }
  return out;
}

/** The form's fields checked and tidied, or the first thing wrong with them. */
export function readPreferencesForm(
  form: FormLike,
): { ok: true; settings: Settings } | { ok: false; error: PreferencesFormError; total?: number } {
  const lists = {} as Record<ListKey, string[]>;
  for (const key of LIST_KEYS) {
    const items = readList(text(form, key));
    if (items.length > MAX_ITEMS) return { ok: false, error: 'too-many' };
    if (items.some((i) => i.length > MAX_ITEM_LENGTH)) return { ok: false, error: 'too-long' };
    lists[key] = items;
  }

  const weights = {} as Weights;
  for (const key of WEIGHT_KEYS) {
    const raw = text(form, `weight_${key}`).trim();
    if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) return { ok: false, error: 'bad-weight' };
    weights[key] = Number(raw);
  }
  const total = weightsTotal(weights);
  if (total !== 100) return { ok: false, error: 'weights-total', total };

  return { ok: true, settings: { ...lists, weights } };
}

export function weightsTotal(weights: Weights): number {
  return WEIGHT_KEYS.reduce((sum, k) => sum + weights[k], 0);
}

/** Save the settings as a new version and return its number. Old versions are never changed. */
export function savePreferences(db: DatabaseSync, settings: Settings): number {
  const result = db.prepare('INSERT INTO preferences (settings) VALUES (?)').run(JSON.stringify(settings));
  const version = Number(result.lastInsertRowid);
  logActivity(db, { actor: 'Dane', kind: 'preferences-saved', summary: `You saved your preferences (version ${version}).` });
  return version;
}

/** The version in force (the newest), or undefined before the first save. */
export function currentPreferences(db: DatabaseSync): SavedPreferences | undefined {
  const row = db.prepare(`${SELECT} ORDER BY version DESC LIMIT 1`).get();
  return row ? toSaved(row) : undefined;
}

/** One version by its number, so a score can show the preferences it used. */
export function preferencesVersion(db: DatabaseSync, version: number): SavedPreferences | undefined {
  const row = db.prepare(`${SELECT} WHERE version = ?`).get(version);
  return row ? toSaved(row) : undefined;
}

/** Every version, newest first. */
export function listPreferenceVersions(db: DatabaseSync): SavedPreferences[] {
  return db.prepare(`${SELECT} ORDER BY version DESC`).all().map(toSaved);
}

const SELECT = 'SELECT version, settings, created_at FROM preferences';

function toSaved(row: Record<string, unknown>): SavedPreferences {
  return { version: Number(row.version), settings: toSettings(String(row.settings)), createdAt: String(row.created_at) };
}

/** A stored row read defensively: anything missing or the wrong shape falls back to empty / the default weight. */
function toSettings(json: string): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch {
    // The table refuses invalid JSON, so this is only a guard.
  }
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const w = (raw.weights && typeof raw.weights === 'object' ? raw.weights : {}) as Record<string, unknown>;
  const weights = {} as Weights;
  for (const k of WEIGHT_KEYS) weights[k] = typeof w[k] === 'number' ? w[k] : DEFAULT_WEIGHTS[k];
  return {
    themes: list(raw.themes),
    requiredTech: list(raw.requiredTech),
    unsupportedTech: list(raw.unsupportedTech),
    exclusions: list(raw.exclusions),
    weights,
  };
}
