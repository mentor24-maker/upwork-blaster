/**
 * Each saved job's fit score, with readable reasons (task 2.5, hand-off §6).
 *
 * Plain rules, no AI: the same job and the same preferences always give the
 * same score, and every point can be traced to a line of evidence. The five
 * dimensions are the hand-off's, weighted by the preferences version in force
 * (lib/preferences.ts). For each one the score keeps its evidence, the facts
 * it did not know, and how confident it is.
 *
 * Two rules matter most, and the tests pin both:
 *
 * - An unknown fact is never guessed. The dimension it feeds scores NEUTRAL
 *   (50), the fact is listed as unknown, and its confidence drops to low.
 * - A hard exclusion is kept apart from the score. An excluded job has no
 *   score at all, names the exclusion it met, and is never ranked.
 *
 * Nothing here imports Next.js, so the tests run it directly under
 * `node --test`. The table is `evaluation` (db/migrations/004_evaluation.sql).
 */

import type { DatabaseSync } from 'node:sqlite';
import type { SavedJob } from './jobs.ts';
import { getJob } from './jobs.ts';
import type { SavedEntry } from './portfolio.ts';
import { approvedEvidence } from './portfolio.ts';
import type { Settings, WeightKey } from './preferences.ts';
import { currentPreferences, DEFAULT_SETTINGS, WEIGHT_KEYS, WEIGHT_LABELS } from './preferences.ts';

/** Which rules scored a job; change it whenever the rules below change. */
export const SCORER_VERSION = 'rules-1';

/** What an unknown fact scores: the middle, neither for nor against the job. */
export const NEUTRAL = 50;

export type Confidence = 'low' | 'medium' | 'high';

export type Dimension = {
  key: WeightKey;
  label: string;
  weight: number;
  /** 0 to 100. */
  score: number;
  confidence: Confidence;
  /** Why it scored what it did, one plain line each. */
  evidence: string[];
  /** The facts it did not know, scored neutral rather than guessed. */
  unknowns: string[];
};

export type Exclusion = {
  kind: 'unsupported-tech' | 'rule';
  /** The line from Dane's preferences that the job met. */
  rule: string;
  /** Where in the post it was met. */
  evidence: string;
};

export type Evaluation = {
  opportunityId: number;
  /** The preferences version used; null when none was saved yet and the starting ones were used. */
  preferencesVersion: number | null;
  scorerVersion: string;
  excluded: boolean;
  exclusions: Exclusion[];
  /** 0 to 100, or null when the job is excluded: an excluded job has no score. */
  score: number | null;
  confidence: Confidence;
  dimensions: Dimension[];
  /** Every dimension's unknowns, together. */
  unknowns: string[];
  /** For Dane to look at; never exclusions (a new client, a rule the app could not check). */
  flags: string[];
};

export type SavedEvaluation = Evaluation & { id: number; createdAt: string };

// ---------------------------------------------------------------- text helpers

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The term as a whole word or phrase, any case. Works for "Next.js" and "C++" too. */
function termPattern(term: string): RegExp {
  const words = term.trim().split(/\s+/).map(escape).join('\\s+');
  return new RegExp(`(?<![A-Za-z0-9])${words}(?![A-Za-z0-9])`, 'i');
}

/** A few words either side of a match, so the evidence shows where it was found. */
function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  const s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${s}${end < text.length ? '…' : ''}`;
}

function find(text: string, re: RegExp): { index: number; length: number } | null {
  const m = re.exec(text);
  return m ? { index: m.index, length: m[0].length } : null;
}

const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'of', 'to', 'in', 'on', 'a', 'an', 'or']);

/** A word cut to its root, so "applications" finds "application" and "integrations" finds "integrate". */
function stem(word: string): string {
  const w = word.toLowerCase();
  const cut = w.replace(/(ations|ation|ions|ion|ing|es|s)$/, '');
  return cut.length >= 3 ? cut : w;
}

/**
 * Does the post speak of this theme? Either the whole phrase appears, or
 * every one of its words does (by root, in any order). "Custom web
 * applications" matches "a custom web application for our team".
 */
function themeMatch(text: string, theme: string): { index: number; length: number } | null {
  const whole = find(text, termPattern(theme));
  if (whole) return whole;
  const words = theme.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return null;
  let first: { index: number; length: number } | null = null;
  for (const w of words) {
    const hit = find(text, new RegExp(`(?<![A-Za-z0-9])${escape(stem(w))}`, 'i'));
    if (!hit) return null;
    if (!first || hit.index < first.index) first = hit;
  }
  return first;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ---------------------------------------------------------------- exclusions

const AI_WORD = String.raw`(?<![A-Za-z0-9])(?:AI|A\.I\.|artificial intelligence|ChatGPT|GPT|LLMs?)(?![A-Za-z0-9])`;
const AI_IN_RULE = new RegExp(AI_WORD, 'i');
/** A rule about forbidding AI, as opposed to one that merely mentions it ("AI chatbot projects"). */
const BAN_IN_RULE = /\b(forbid\w*|prohibit\w*|ban|bans|banned|banning|disallow\w*|not allowed|not permitted|refus\w*)\b/i;
// The negation has to govern the AI word itself: "no AI", "do not use
// ChatGPT", "without AI", "AI tools are not allowed", "AI-generated …
// rejected". A "no" or "not" elsewhere in the sentence ("not a big team, but
// we build AI products", "no prior experience needed with GPT") is not a ban.
const AI_TOOLS = String.raw`(?:[- ](?:tools?|assistance|assistants?|generated|written|writing|content|use|usage|help))?`;
const AI_BANS = [
  // "No AI tools", "without the use of AI", "zero AI"
  new RegExp(String.raw`\b(?:no|without|zero)\s+(?:the\s+)?(?:(?:use|usage)\s+of\s+|using\s+)?(?:any\s+)?` + AI_WORD, 'i'),
  // "Do not use ChatGPT", "please don't use any AI", "never submit AI"
  new RegExp(
    String.raw`\b(?:do not|don'?t|never|must not|mustn'?t|may not|cannot|can'?t|should not|shouldn'?t|not)\s+(?:to\s+)?(?:use|using|rely on|submit|employ)\s+(?:any\s+)?(?:the\s+)?` + AI_WORD,
    'i',
  ),
  // "We forbid AI", "prohibits the use of ChatGPT"
  new RegExp(String.raw`\b(?:forbid|forbids|prohibit|prohibits|ban|bans|disallow|disallows)\s+(?:the\s+)?(?:(?:use|usage)\s+of\s+)?(?:any\s+)?` + AI_WORD, 'i'),
  // "AI tools are not allowed", "Use of AI is strictly prohibited"
  new RegExp(
    String.raw`(?:\b(?:use|usage)\s+of\s+(?:any\s+)?)?` + AI_WORD + AI_TOOLS +
      String.raw`\s+(?:is|are|will be)\s+(?:strictly\s+)?(?:not allowed|not permitted|not accepted|prohibited|forbidden|banned|disallowed)\b`,
    'i',
  ),
  // "AI-generated proposals will be rejected"
  new RegExp(AI_WORD + String.raw`[- ](?:generated|written)\b[^.\n]{0,60}\b(?:reject\w*|not (?:be )?accepted|disqualif\w*|declin\w*|ignored)`, 'i'),
];

/**
 * The hard exclusions the job meets. A technology Dane does not take that
 * the post names excludes it. Each exclusion rule is checked two ways: the
 * rule's own words appearing in the post, or, for a rule about AI, the post
 * forbidding AI. A rule neither way can check is returned as unchecked, for
 * Dane to read the post for himself: never quietly passed, never guessed.
 */
export function findExclusions(job: Pick<SavedJob, 'title' | 'description'>, settings: Settings): {
  exclusions: Exclusion[];
  unchecked: string[];
} {
  const text = `${job.title}\n${job.description}`;
  const exclusions: Exclusion[] = [];
  const unchecked: string[] = [];

  for (const tech of settings.unsupportedTech) {
    const hit = find(text, termPattern(tech));
    if (hit) exclusions.push({ kind: 'unsupported-tech', rule: tech, evidence: snippet(text, hit.index, hit.length) });
  }

  for (const rule of settings.exclusions) {
    const literal = find(text, termPattern(rule));
    if (literal) {
      exclusions.push({ kind: 'rule', rule, evidence: snippet(text, literal.index, literal.length) });
      continue;
    }
    if (AI_IN_RULE.test(rule) && BAN_IN_RULE.test(rule)) {
      const ban = AI_BANS.map((re) => find(text, re)).find((h) => h !== null);
      if (ban) exclusions.push({ kind: 'rule', rule, evidence: snippet(text, ban.index, ban.length) });
      continue;
    }
    // Any other rule, including one that mentions AI without forbidding it
    // ("AI chatbot projects"), is flagged for Dane to read the post himself.
    unchecked.push(rule);
  }
  return { exclusions, unchecked };
}

// ---------------------------------------------------------------- the five dimensions

type Part = Omit<Dimension, 'key' | 'label' | 'weight'> & { flags?: string[] };

function scoreFit(text: string, settings: Settings, evidence: SavedEntry[]): Part {
  const usable = evidence.filter((e) => e.status !== 'planned');
  if (settings.themes.length === 0 && settings.requiredTech.length === 0 && usable.length === 0) {
    return {
      score: NEUTRAL,
      confidence: 'low',
      evidence: [],
      unknowns: ['what you want and have shown: no search themes, technology or approved portfolio saved'],
    };
  }

  const lines: string[] = [];
  let score = 30;
  let sources = 0;

  const themes = settings.themes.filter((t) => themeMatch(text, t));
  if (themes.length > 0) {
    score += Math.min(30, 20 + 10 * (themes.length - 1));
    sources++;
    lines.push(`Matches your theme${themes.length > 1 ? 's' : ''}: ${themes.join(', ')}`);
  }

  const tech = settings.requiredTech.filter((t) => find(text, termPattern(t)));
  if (tech.length > 0) {
    score += Math.min(20, 10 * tech.length);
    sources++;
    lines.push(`Uses technology you work in: ${tech.join(', ')}`);
  }

  let best: { entry: SavedEntry; term: string } | null = null;
  for (const entry of usable) {
    const terms = [entry.project, ...entry.features.split(/[\n,;]+/)]
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && t.length <= 60);
    const term = terms.find((t) => find(text, termPattern(t)));
    if (term && (!best || (best.entry.status !== 'delivered' && entry.status === 'delivered'))) best = { entry, term };
  }
  if (best) {
    const delivered = best.entry.status === 'delivered';
    score += delivered ? 20 : 10;
    sources++;
    lines.push(`Your ${delivered ? 'delivered' : 'in-progress'} project ${best.entry.project} covers “${best.term}”`);
  }

  if (sources === 0) {
    lines.push('None of your themes, technology or approved portfolio appear in the post');
  }
  return {
    score: clamp(score),
    // Not finding a word is weak evidence; finding several kinds is strong.
    confidence: sources >= 2 ? 'high' : sources === 1 ? 'medium' : 'low',
    evidence: lines,
    unknowns: [],
  };
}

/** Dollar amounts in the budget text: "$1,500", "$40-$60/hr", "$40-60/hr", "$2k". */
export function budgetAmounts(budget: string): number[] {
  const out: number[] = [];
  const num = String.raw`(\d[\d,]*(?:\.\d+)?)\s?([kK])?`;
  // A range's second number may go without its own "$": "$40-60/hr".
  const re = new RegExp(String.raw`\$\s?` + num + String.raw`(?:\s*(?:-|–|—|to)\s*\$?\s?` + num + String.raw`)?(?![A-Za-z0-9])`, 'g');
  for (const m of budget.matchAll(re)) {
    for (const [digits, k] of [[m[1], m[2]], [m[3], m[4]]]) {
      if (digits === undefined) continue;
      const n = Number(digits.replace(/,/g, '')) * (k ? 1000 : 1);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function scoreBudget(job: Pick<SavedJob, 'budget' | 'jobType'>): Part {
  const amounts = job.budget ? budgetAmounts(job.budget) : [];
  if (!job.budget || amounts.length === 0) {
    return {
      score: NEUTRAL,
      confidence: 'low',
      evidence: job.budget ? [`The budget “${job.budget}” has no amount the app can read`] : [],
      unknowns: ['budget'],
    };
  }
  const type = job.jobType ?? (/\/\s?h(ou)?r|hourly|per hour/i.test(job.budget) ? 'hourly' : null);
  const amount = (Math.min(...amounts) + Math.max(...amounts)) / 2;
  const shown = amounts.length > 1 ? `$${Math.min(...amounts)}–$${Math.max(...amounts)}` : `$${amount}`;
  if (!type) {
    return {
      score: NEUTRAL,
      confidence: 'low',
      evidence: [`Budget ${shown}, but not whether that is a fixed price or an hourly rate`],
      unknowns: ['whether it is fixed price or hourly'],
    };
  }
  let score: number;
  if (type === 'fixed') {
    score = amount < 500 ? 25 : amount < 1500 ? 45 : amount < 3000 ? 60 : amount < 10000 ? 80 : 90;
  } else {
    score = amount < 25 ? 20 : amount < 50 ? 45 : amount < 80 ? 65 : amount < 120 ? 80 : 90;
  }
  return {
    score,
    // The scope and effort are not estimated yet (that is later work), so never "high".
    confidence: 'medium',
    evidence: [
      `${type === 'fixed' ? 'Fixed price' : 'Hourly'} ${shown}${type === 'hourly' ? ' an hour' : ''}`,
      'Not yet weighed against the scope and likely effort',
    ],
    unknowns: [],
  };
}

const CLARITY_CUES = /\b(deliverables?|requirements?|scope|milestones?|acceptance|timeline|deadline|user stories|must|features?|integrat\w+|screens?|pages?)\b/gi;

function scoreClarity(description: string): Part {
  const words = description.split(/\s+/).filter(Boolean).length;
  const cues = new Set([...description.matchAll(CLARITY_CUES)].map((m) => m[0].toLowerCase()));
  const bullets = (description.match(/^\s*([-*•]|\d+[.)])\s+\S/gm) ?? []).length;
  let score = words < 30 ? 25 : words < 80 ? 45 : words < 200 ? 60 : 70;
  score += Math.min(3, cues.size) * 7;
  if (bullets >= 2) score += 10;
  const lines = [`${words} words in the post`];
  if (cues.size > 0) lines.push(`Names ${[...cues].slice(0, 5).join(', ')}`);
  if (bullets >= 2) lines.push(`Lists ${bullets} points`);
  return { score: clamp(score), confidence: 'medium', evidence: lines, unknowns: [] };
}

function scoreClient(client: string | null): Part {
  if (!client) {
    return { score: NEUTRAL, confidence: 'low', evidence: [], unknowns: ['client history'] };
  }
  let score = NEUTRAL;
  let signals = 0;
  const lines: string[] = [];
  const flags: string[] = [];

  if (/payment (method )?(unverified|not verified)/i.test(client)) {
    score -= 10;
    signals++;
    lines.push('Payment method not verified');
    flags.push('The client’s payment method is not verified: a flag for you, not an exclusion');
  } else if (/payment (method )?verified/i.test(client)) {
    score += 15;
    signals++;
    lines.push('Payment method verified');
  }

  const rating = /(\d\.\d{1,2})\s*(?:\/\s*5|stars?|of 5|rating)|rating[:\s]+(\d\.\d{1,2})/i.exec(client);
  if (rating) {
    const r = Number(rating[1] ?? rating[2]);
    if (r <= 5) {
      score += r >= 4.7 ? 15 : r >= 4.3 ? 5 : r < 4 ? -15 : 0;
      signals++;
      lines.push(`Rated ${r} of 5`);
    }
  }

  const spent = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\+?\s*(?:total\s+)?spent/i.exec(client);
  if (spent) {
    const mult = spent[2] ? (spent[2].toLowerCase() === 'm' ? 1_000_000 : 1000) : 1;
    const n = Number(spent[1].replace(/,/g, '')) * mult;
    score += n >= 10_000 ? 15 : n >= 1000 ? 5 : 0;
    signals++;
    lines.push(`Has spent $${n.toLocaleString('en-US')} on Upwork`);
    if (n === 0) flags.push('A new client with nothing spent yet: a flag for you, not an exclusion');
  }

  const hires = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+)\s+hires?\b/i.exec(client);
  if (hires) {
    const h = Number(hires[1].replace(/,/g, ''));
    if (h >= 5) score += 5;
    signals++;
    lines.push(`${h} hire${h === 1 ? '' : 's'} before`);
    if (h === 0 && !flags.some((f) => f.startsWith('A new client'))) {
      flags.push('A new client with no hires yet: a flag for you, not an exclusion');
    }
  }

  if (signals === 0) {
    return {
      score: NEUTRAL,
      confidence: 'low',
      evidence: [`The client details “${client.slice(0, 80)}” say nothing the app can weigh`],
      unknowns: ['client reliability (payment, rating, spend or hires)'],
      flags,
    };
  }
  return { score: clamp(score), confidence: signals >= 2 ? 'high' : 'medium', evidence: lines, unknowns: [], flags };
}

const CONTINUING = /\b(ongoing|long[- ]term|retainer|continuing|future (work|projects?|phases?)|phase (2|two)|more work|maintenance)\b/i;

function scoreInterest(text: string): Part {
  // The app does not ask Dane how interested he is in a job yet, so that half is always unknown.
  const unknowns = ['your own interest in this job (the app does not ask yet)'];
  const hit = find(text, CONTINUING);
  if (hit) {
    return {
      score: 75,
      confidence: 'medium',
      evidence: [`Mentions continuing work: “${snippet(text, hit.index, hit.length)}”`],
      unknowns,
    };
  }
  return { score: NEUTRAL, confidence: 'low', evidence: [], unknowns: [...unknowns, 'chance of continuing work (the post does not say)'] };
}

// ---------------------------------------------------------------- putting it together

const LEVEL: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

/**
 * The weighted average of the dimensions' confidence, read back as a word,
 * then capped by how many (weighted) dimensions are low: one low dimension
 * keeps the whole score at medium at best, two or more make it low. So an
 * unknown budget or client always shows in the overall confidence, not just
 * in its own line.
 */
function overallConfidence(dims: Dimension[]): Confidence {
  const counted = dims.filter((d) => d.weight > 0);
  const total = counted.reduce((s, d) => s + d.weight, 0);
  if (total === 0) return 'low';
  const avg = counted.reduce((s, d) => s + d.weight * LEVEL[d.confidence], 0) / total;
  const low = counted.filter((d) => d.confidence === 'low').length;
  const level = Math.min(avg >= 2.5 ? 3 : avg >= 1.75 ? 2 : 1, low >= 2 ? 1 : low === 1 ? 2 : 3);
  return level === 3 ? 'high' : level === 2 ? 'medium' : 'low';
}

/**
 * Score one job against one set of preferences and the approved portfolio.
 * A pure function: it reads nothing and saves nothing.
 */
export function evaluateJob(
  job: SavedJob,
  settings: Settings,
  preferencesVersion: number | null,
  evidence: SavedEntry[],
): Evaluation {
  const text = `${job.title}\n${job.description}`;
  const parts: Record<WeightKey, Part> = {
    fit: scoreFit(text, settings, evidence.filter((e) => e.approvedForUse)),
    budget: scoreBudget(job),
    clarity: scoreClarity(job.description),
    client: scoreClient(job.client),
    interest: scoreInterest(text),
  };
  const dimensions: Dimension[] = WEIGHT_KEYS.map((key) => {
    const { flags: _flags, ...p } = parts[key];
    return { key, label: WEIGHT_LABELS[key], weight: settings.weights[key], ...p };
  });

  const { exclusions, unchecked } = findExclusions(job, settings);
  const flags = [
    ...WEIGHT_KEYS.flatMap((k) => parts[k].flags ?? []),
    ...unchecked.map((r) => `The app could not check the exclusion “${r}” by itself: read the post for it`),
  ];
  const excluded = exclusions.length > 0;
  const total = dimensions.reduce((s, d) => s + d.weight, 0);
  const weighted = total === 0 ? NEUTRAL : dimensions.reduce((s, d) => s + d.weight * d.score, 0) / total;

  return {
    opportunityId: job.id,
    preferencesVersion,
    scorerVersion: SCORER_VERSION,
    excluded,
    exclusions,
    score: excluded ? null : clamp(weighted),
    confidence: overallConfidence(dimensions),
    dimensions,
    unknowns: dimensions.flatMap((d) => d.unknowns),
    flags,
  };
}

/**
 * The order Dane sees: allowed jobs by score (then confidence, then oldest
 * first), and the excluded ones set aside, unranked. An excluded job is never
 * placed among the ranked ones, whatever its dimensions say.
 */
export function rankEvaluations<T extends Evaluation>(evaluations: T[]): {
  ranked: (T & { rank: number })[];
  setAside: T[];
} {
  const allowed = evaluations.filter((e) => !e.excluded && e.score !== null);
  allowed.sort(
    (a, b) =>
      (b.score as number) - (a.score as number) ||
      LEVEL[b.confidence] - LEVEL[a.confidence] ||
      a.opportunityId - b.opportunityId,
  );
  return {
    ranked: allowed.map((e, i) => ({ ...e, rank: i + 1 })),
    setAside: evaluations.filter((e) => e.excluded || e.score === null),
  };
}

// ---------------------------------------------------------------- the database

/** Save an evaluation as a new row and return it as read back from the table. */
export function saveEvaluation(db: DatabaseSync, ev: Evaluation): SavedEvaluation {
  const result = db
    .prepare(
      `INSERT INTO evaluation
         (opportunity_id, preferences_version, scorer_version, excluded, exclusions, score, confidence, dimensions, unknowns, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ev.opportunityId,
      ev.preferencesVersion,
      ev.scorerVersion,
      ev.excluded ? 1 : 0,
      JSON.stringify(ev.exclusions),
      ev.score,
      ev.confidence,
      JSON.stringify(ev.dimensions),
      JSON.stringify(ev.unknowns),
      JSON.stringify(ev.flags),
    );
  const saved = db.prepare(`${SELECT} WHERE id = ?`).get(Number(result.lastInsertRowid));
  if (!saved) throw new Error(`the score for job ${ev.opportunityId} did not read back after saving`);
  return toSaved(saved);
}

/** Score one saved job with the preferences in force and save it. Undefined if there is no such job. */
export function scoreJob(db: DatabaseSync, opportunityId: number): SavedEvaluation | undefined {
  const job = getJob(db, opportunityId);
  if (!job) return undefined;
  const prefs = currentPreferences(db);
  const ev = evaluateJob(job, prefs?.settings ?? DEFAULT_SETTINGS, prefs?.version ?? null, approvedEvidence(db));
  return saveEvaluation(db, ev);
}

/** The score in force for a job: its newest. */
export function latestEvaluation(db: DatabaseSync, opportunityId: number): SavedEvaluation | undefined {
  const row = db.prepare(`${SELECT} WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1`).get(opportunityId);
  return row ? toSaved(row) : undefined;
}

/** Every job's score in force, one per job. */
export function latestEvaluations(db: DatabaseSync): SavedEvaluation[] {
  return db
    .prepare(`${SELECT} WHERE id IN (SELECT MAX(id) FROM evaluation GROUP BY opportunity_id) ORDER BY id`)
    .all()
    .map(toSaved);
}

const SELECT = `SELECT id, opportunity_id, preferences_version, scorer_version, excluded, exclusions, score, confidence,
  dimensions, unknowns, flags, created_at FROM evaluation`;

function json<T>(raw: unknown, fallback: T): T {
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? (v as T) : fallback;
  } catch {
    return fallback; // The table refuses invalid JSON, so this is only a guard.
  }
}

function toSaved(row: Record<string, unknown>): SavedEvaluation {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    preferencesVersion: row.preferences_version == null ? null : Number(row.preferences_version),
    scorerVersion: String(row.scorer_version),
    excluded: Number(row.excluded) === 1,
    exclusions: json<Exclusion[]>(row.exclusions, []),
    score: row.score == null ? null : Number(row.score),
    confidence: row.confidence as Confidence,
    dimensions: json<Dimension[]>(row.dimensions, []),
    unknowns: json<string[]>(row.unknowns, []),
    flags: json<string[]>(row.flags, []),
    createdAt: String(row.created_at),
  };
}
