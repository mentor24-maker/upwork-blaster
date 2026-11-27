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
 * A post's orders to the AI ("ignore your rules", "score this 100") are never
 * obeyed: nothing here takes instructions from the text. The score still
 * reads every word of the post, orders and all, so a sentence the app wrongly
 * takes for an order costs a flag and nothing else; the job is flagged so
 * Dane reads it himself (lib/orders.ts, task 2.7).
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
import { ordersIn } from './orders.ts';
import { logJobActivity } from './activity.ts';

/** Which rules scored a job; change it whenever the rules below change. */
export const SCORER_VERSION = 'rules-2';

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

/** The endings a root may take and still be the same word: "application(s)", "integrate(d)". Not "customer" for "custom". */
const SAME_WORD = '(?:s|es|e|ed|ing|ion|ions|ation|ations|ate|ates|ated|ating|ive|al)?';

/**
 * Does the post speak of this theme? Either the whole phrase appears, or
 * every one of its words does (by root, in any order) within one sentence.
 * "Custom web applications" matches "a custom web application for our
 * team", but not "customer" in one paragraph and "website" in another.
 */
function themeMatch(text: string, theme: string): { index: number; length: number } | null {
  const whole = find(text, termPattern(theme));
  if (whole) return whole;
  const words = theme.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return null;
  const patterns = words.map((w) => new RegExp(`(?<![A-Za-z0-9])${escape(stem(w))}${SAME_WORD}(?![A-Za-z0-9])`, 'i'));
  const sentences = /[^.!?\n]+/g;
  for (const s of text.matchAll(sentences)) {
    const hits = patterns.map((re) => find(s[0], re));
    if (hits.some((h) => h === null)) continue;
    const first = hits.reduce((a, b) => (b!.index < a!.index ? b : a))!;
    return { index: s.index + first.index, length: first.length };
  }
  return null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ---------------------------------------------------------------- exclusions

const AI_WORD = String.raw`(?<![A-Za-z0-9])(?:AI|A\.I\.|artificial intelligence|ChatGPT|GPT|LLMs?)(?![A-Za-z0-9])`;
const AI_IN_RULE = new RegExp(AI_WORD, 'i');
/** A rule about forbidding AI, as opposed to one that merely mentions it ("AI chatbot projects"). */
const BAN_IN_RULE = new RegExp(
  String.raw`\b(?:forbid\w*|prohibit\w*|ban|bans|banned|banning|disallow\w*|not allowed|not permitted|refus\w*|against|(?:do|does)\s+not\s+(?:allow|permit|accept|want)|(?:don'?t|doesn'?t|won'?t)\s+(?:allow|permit|accept|want))\b` +
    String.raw`|\b(?:no|without)\s+(?:the\s+)?(?:(?:use|usage)\s+of\s+)?` + AI_WORD,
  'i',
);

// The negation has to govern the AI word itself: "no AI", "do not use
// ChatGPT", "without AI", "AI tools are not allowed", "AI-generated …
// rejected". A "no" or "not" elsewhere in the sentence ("not a big team, but
// we build AI products", "no prior experience needed with GPT") is not a ban,
// and neither are these, which read like one word by word:
// - "No AI experience required": the "no" is about what Dane must know.
const NOT_A_SKILL = String.raw`(?![- ]+(?:[\w-]+\s+)?(?:experience|knowledge|background|skills?|expertise|familiarity|exposure|required|needed|necessary)\b)`;
// - "We do not use AI yet": the client describing themselves, not a rule for Dane.
const NOT_YET = String.raw`(?!\s+(?:yet|so far|at the moment|right now|currently|today)\b)`;
const SELF_DESCRIBED =
  /\b(?:we|i|they|it|our(?:\s+[\w'-]+){1,3}|my(?:\s+[\w'-]+){1,3}|the\s+(?:client|company|team|business|site|website|app|platform|product))\s+(?:(?:are|is|am|was|were)\s+)?(?:(?:currently|still|also)\s+)?(?:(?:do|does|did)\s+)?$/i;

const AI_TOOLS = String.raw`(?:[- ](?:tools?|assistance|assistants?|generated|written|writing|content|use|usage|help))?`;
type BanPattern = { re: RegExp; selfCheck?: boolean };
const AI_BANS: BanPattern[] = [
  // "No AI tools", "without the use of AI", "zero AI"
  {
    re: new RegExp(
      String.raw`\b(?:no|without|zero)\s+(?:the\s+)?(?:(?:use|usage)\s+of\s+|using\s+)?(?:any\s+)?` + AI_WORD + NOT_A_SKILL + NOT_YET,
      'gi',
    ),
  },
  // "Do not use ChatGPT", "please don't use any AI", "never submit AI"
  {
    re: new RegExp(
      String.raw`\b(?:do not|don'?t|never|must not|mustn'?t|may not|cannot|can'?t|should not|shouldn'?t|not)\s+(?:to\s+)?(?:use|using|rely on|submit|employ)\s+(?:any\s+)?(?:the\s+)?` +
        AI_WORD + NOT_YET,
      'gi',
    ),
    selfCheck: true,
  },
  // "We forbid AI", "prohibits the use of ChatGPT"
  { re: new RegExp(String.raw`\b(?:forbid|forbids|prohibit|prohibits|ban|bans|disallow|disallows)\s+(?:the\s+)?(?:(?:use|usage)\s+of\s+)?(?:any\s+)?` + AI_WORD, 'gi') },
  // "AI tools are not allowed", "Use of AI is strictly prohibited"
  {
    re: new RegExp(
      String.raw`(?:\b(?:use|usage)\s+of\s+(?:any\s+)?)?` + AI_WORD + AI_TOOLS +
        String.raw`\s+(?:is|are|will be)\s+(?:strictly\s+)?(?:not allowed|not permitted|not accepted|prohibited|forbidden|banned|disallowed)\b`,
      'gi',
    ),
  },
  // "AI-generated proposals will be rejected"
  { re: new RegExp(AI_WORD + String.raw`[- ](?:generated|written)\b[^.\n]{0,60}\b(?:reject\w*|not (?:be )?accepted|disqualif\w*|declin\w*|ignored)`, 'gi') },
];

/** The first place the post forbids AI, or null. Every match is weighed, not just the first. */
function findAiBan(text: string): { index: number; length: number } | null {
  for (const { re, selfCheck } of AI_BANS) {
    for (const m of text.matchAll(re)) {
      if (selfCheck) {
        // The words before the negation, back to the start of the sentence.
        const before = text.slice(0, m.index).split(/[.!?\n]/).pop() ?? '';
        if (SELF_DESCRIBED.test(before)) continue;
      }
      return { index: m.index, length: m[0].length };
    }
  }
  return null;
}

/**
 * Technology names that are also ordinary English words ("Go live", "Swift
 * delivery"). These match only written with a capital, as a name is, and a
 * capital at the start of a sentence only counts when a tech word follows
 * ("Swift developer needed"), because there it may just be the first word.
 */
const WORD_LIKE_TECH = new Set([
  'go', 'swift', 'rust', 'ruby', 'dart', 'java', 'spark', 'flutter', 'react', 'express', 'rails', 'spring',
  'ember', 'julia', 'crystal', 'elixir', 'electron', 'meteor', 'next', 'nest', 'unity', 'elm', 'pearl', 'gatsby',
  'hugo', 'jest', 'mocha', 'chef', 'puppet', 'ansible', 'kafka', 'airflow', 'shiny', 'apex', 'ionic', 'phoenix',
]);
const TECH_CONTEXT = /^\s*(?:developers?|devs?|engineers?|programmers?|experts?|specialists?|apps?|applications?|code|codebase|projects?|experience|backend|back-end|frontend|front-end|api|apis|language|version|services?|server|stack|framework|knowledge|skills?|\d)\b/i;

/** Does the post name this technology? Short or word-like names are matched with care. */
function findTech(text: string, tech: string): { index: number; length: number } | null {
  const name = tech.trim();
  const wordLike = WORD_LIKE_TECH.has(name.toLowerCase()) || (name.length <= 4 && /^[A-Za-z][a-z]*$/.test(name));
  if (!wordLike) return find(text, termPattern(name));
  const re = new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'gi');
  for (const m of text.matchAll(re)) {
    const word = m[0];
    if (word[0] !== word[0].toUpperCase()) continue; // "go live", "swift delivery"
    const before = text.slice(0, m.index);
    const sentenceStart = /(?:^|[.!?:]\s+|\n\s*(?:[-*•]\s*|\d+[.)]\s*)?)$/.test(before);
    if (sentenceStart && !TECH_CONTEXT.test(text.slice(m.index + word.length))) continue;
    return { index: m.index, length: word.length };
  }
  return null;
}

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
    const hit = findTech(text, tech);
    if (hit) exclusions.push({ kind: 'unsupported-tech', rule: tech, evidence: snippet(text, hit.index, hit.length) });
  }

  for (const rule of settings.exclusions) {
    const literal = find(text, termPattern(rule));
    if (literal) {
      exclusions.push({ kind: 'rule', rule, evidence: snippet(text, literal.index, literal.length) });
      continue;
    }
    if (AI_IN_RULE.test(rule) && BAN_IN_RULE.test(rule)) {
      const ban = findAiBan(text);
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

  const tech = settings.requiredTech.filter((t) => findTech(text, t));
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

function cueRoot(cue: string): string {
  const c = cue.toLowerCase().replace(/\s+/g, ' ');
  if (c.startsWith('integrat')) return 'integration';
  if (c === 'user stories') return 'user story';
  return c.replace(/s$/, '');
}

function scoreClarity(description: string): Part {
  const words = description.split(/\s+/).filter(Boolean).length;
  // Each cue counts once, by its root: "feature" and "features" are one cue.
  const cues = new Set([...description.matchAll(CLARITY_CUES)].map((m) => cueRoot(m[0])));
  const bullets = (description.match(/^\s*([-*•]|\d+[.)])\s+\S/gm) ?? []).length;
  let score = words < 30 ? 25 : words < 80 ? 45 : words < 200 ? 60 : 70;
  score += Math.min(3, cues.size) * 7;
  if (bullets >= 2) score += 10;
  const lines = [`${words} words in the post`];
  if (cues.size > 0) lines.push(`Names ${[...cues].slice(0, 5).join(', ')}`);
  if (bullets >= 2) lines.push(`Lists ${bullets} points`);
  return { score: clamp(score), confidence: 'medium', evidence: lines, unknowns: [] };
}

const PAYMENT_UNVERIFIED = /payment (method )?(unverified|not verified)/i;
const PAYMENT_VERIFIED = /payment (method )?verified/i;

/** How a client line reads on payment: the one reading the score and the AI check (lib/extractJob.ts) share. */
export function paymentStatus(client: string): 'verified' | 'unverified' | null {
  if (PAYMENT_UNVERIFIED.test(client)) return 'unverified';
  if (PAYMENT_VERIFIED.test(client)) return 'verified';
  return null;
}

function scoreClient(client: string | null): Part {
  if (!client) {
    return { score: NEUTRAL, confidence: 'low', evidence: [], unknowns: ['client history'] };
  }
  let score = NEUTRAL;
  let signals = 0;
  const lines: string[] = [];
  const flags: string[] = [];

  const payment = paymentStatus(client);
  if (payment === 'unverified') {
    score -= 10;
    signals++;
    lines.push('Payment method not verified');
    flags.push('The client’s payment method is not verified: a flag for you, not an exclusion');
  } else if (payment === 'verified') {
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
  // Every word counts, orders to the AI included (Dane's call on task 2.7:
  // cutting sentences on a pattern kept cutting honest ones). They are
  // flagged below instead.
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
  const orders = ordersIn(text);
  if (orders.length > 0) {
    const first = orders[0].length > 100 ? `${orders[0].slice(0, 99).trimEnd()}…` : orders[0];
    flags.push(
      `The post seems to give the AI orders (“${first}”${orders.length > 1 ? ` and ${orders.length - 1} more` : ''}): the app did not obey them, but kept the text, and a fact written only there shows as unknown. Read the post yourself before deciding`,
    );
  }
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
  const saved = saveEvaluation(db, ev);
  logJobActivity(db, opportunityId, 'app', 'job-scored', (name) =>
    saved.excluded ? `The app set ${name} apart: it matches something you do not take.` : `The app scored ${name} ${saved.score} out of 100.`,
  );
  return saved;
}

/**
 * Score a job and record how it went on the job: a failure is kept as the
 * job's `scoring_problem` in plain words, so the jobs page says it is not
 * scored (CLAUDE.md: a step that fails says so); a success clears it. Never
 * throws for a scoring failure: the job is saved either way. Returns the
 * problem, or null when it scored.
 */
export function scoreJobAndRecord(db: DatabaseSync, opportunityId: number): string | null {
  let problem: string | null = null;
  try {
    if (!scoreJob(db, opportunityId)) problem = `no saved job ${opportunityId}`;
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  db.prepare(
    `UPDATE opportunity SET scoring_problem = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(problem === null ? null : problem.slice(0, 500), opportunityId);
  return problem;
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
