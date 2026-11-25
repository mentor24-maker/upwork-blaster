/**
 * The claim check (task 3.2, hand-off §5C and §13.5): a proposal draft that
 * claims something Dane cannot back up gets a blocking flag, and a flagged
 * draft cannot be approved.
 *
 * Three kinds of claim are caught, each by a plain rule (never by the AI, so
 * a job post cannot talk its way past it):
 *
 *  - **planned-as-delivered**: a sentence names one of Dane's portfolio
 *    projects that is marked "planned" or "in progress", and either uses a
 *    word that says it is finished ("delivered", "built", "launched" ...) or
 *    does not say it is still planned or under way. Writing "I am building X",
 *    "I'm building X", "X is being built" or "X is not yet launched" is
 *    honest; "I built X" or a bare "X handles bookings" is not. The words are
 *    judged in the clause about the project, so "I delivered A and am
 *    building B" says nothing finished about B.
 *  - **unapproved-evidence**: a sentence names a portfolio project Dane has not
 *    switched to "approved for use".
 *  - **invented-number**: a sentence holds a number that appears nowhere in
 *    what the draft is allowed to draw on: the job post (its title, text,
 *    budget, client line and screening questions), Dane's own answers to
 *    those questions, and the approved portfolio entries. "3 years", "cut
 *    costs 40%", "10x faster" or "8yrs" with no source is flagged.
 *
 * Each flag names the sentence and says why in plain words. Flags are never
 * stored: they are worked out afresh from the draft and the portfolio as they
 * are now, every time the workspace is shown or a save is made, so a flag
 * clears the moment its sentence is fixed (or the entry is approved, or the
 * number is added to an approved entry), and a stale "all clear" can never be
 * read. `approvalBlock` is the one question approval (task 3.3) asks.
 *
 * Known limits, both on the side of letting through rather than guessing:
 * projects are matched by their name as written on the Portfolio page, so a
 * draft that paraphrases a name is not matched (the drafting prompt in
 * lib/draft.ts is told to name projects as written); a number the job
 * post itself uses counts as sourced, so "10 years" passes when the post asks
 * for 10 years (and a number in the client line, such as "120 hires", sources
 * "120" anywhere in the draft); and a clause that names no project is read as
 * about the project named just before it, so "I'm building A, and I
 * delivered a similar tool" is flagged for A until it is reworded. A number Dane typed that is true but in no approved entry is
 * flagged until he adds it to one: that is the record that backs it.
 *
 * Nothing here imports Next.js, so the tests run it under `node --test`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { getProposal } from './draft.ts';
import { getJob, type SavedJob } from './jobs.ts';
import { listEntries, STATUS_LABELS, type SavedEntry } from './portfolio.ts';

export type ClaimKind = 'planned-as-delivered' | 'unapproved-evidence' | 'invented-number';

export type ClaimFlag = {
  kind: ClaimKind;
  /** The sentence in the draft the flag is about, as written. */
  sentence: string;
  /** Why it blocks approval, in plain words. */
  why: string;
};

/** Short labels for the workspace, one per kind. */
export const KIND_LABELS: Record<ClaimKind, string> = {
  'planned-as-delivered': 'Presents unfinished work as delivered',
  'unapproved-evidence': 'Cites work not approved for use',
  'invented-number': 'A number with no source',
};

/** Shorter than this, a project name would match ordinary words. */
const MIN_NAME = 3;

/** Words that present work as finished. */
const DONE_WORDS =
  /\b(?:delivered|built|shipped|launched|completed|finished|created|developed|designed|made|implemented|deployed|released|rolled out|went live|is live|are live|in production|used by|serves|serving|handles|handled|powers|powered|ran)\b/i;

/**
 * Words that honestly say work is not finished yet. A contraction counts the
 * same as the words written out ("I'm building", "we're developing").
 */
const NOT_YET_WORDS =
  /\b(?:plan(?:s|ned|ning)?|in progress|under way|underway|(?:am|are|is|currently|now|still|\p{L}+['’](?:m|re|s))\s+(?:building|developing|working on|designing|writing)|working on|will|going to|upcoming|not yet|yet to|prototype|in development|early stage|being (?:built|developed|designed|made|finished|tested)|unfinished|draft)\b/iu;

/**
 * A "done" word that a not-yet phrase around it takes back: "being built",
 * "not yet launched", "not yet in production", "hasn't been deployed",
 * "to be released". These are honest, so the done word in them does not count.
 */
const NEGATED_DONE = new RegExp(
  `(?:\\b(?:not|never|being|be)|n['’]t)(?:\\s+(?:yet|been|fully|quite|completely|be))*\\s+(?:${DONE_WORDS.source})`,
  'gi',
);

/**
 * Where a sentence turns from one thing to the next: commas, semicolons,
 * colons, dashes, brackets, and joining words. A done word is judged in the
 * clause it sits in, so "I delivered A and am building B" says nothing
 * finished about B.
 */
const CLAUSE_BREAK = /[,;:()\u2013\u2014]|\s-\s|\b(?:and|but|while|whereas|although|though|whilst)\b/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern finding a project's name as whole words, any case, any spacing. */
function namePattern(name: string): RegExp | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.join(' ').length < MIN_NAME) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escape).join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
}

/** The draft cut into sentences: by line, then after . ! or ? followed by a space. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=\S)/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
// A number: digits with optional thousands commas or decimals, and an
// optional unit glued on: a k/m/b shorthand that scales it ("5k"), or a unit
// that does not ("10x", "8yrs", "3hrs", "50ms"). Decimals stay whole, so
// "1.5x" is 1.5, never a bare 1. Not one glued to any other letter, so "Web3",
// "S3" or "3D" are names, not figures.
const NUMBER_RE =
  /(?<![\p{L}\p{N}.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:(bn|[kKmMbB](?!s\b)|x|X|years?|yrs?|y|hours?|hrs?|h|mins?|ms|secs?|s|weeks?|wks?|months?|mos?|days?|gb|GB|mb|MB|tb|TB|kb|KB|px)(?![\p{L}\p{N}]))?(?![\p{L}\p{N}]|[.,]\d)/gu;

/** Every number in a text, normalised so "$5,000", "5000" and "5k" compare equal, and "10x" and "10" too. URLs are skipped. */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(URL_RE, ' ').matchAll(NUMBER_RE)) {
    const whole = m[1].replace(/,/g, '');
    const frac = m[2];
    const unit = m[3];
    let value = Number(frac ? `${whole}.${frac}` : whole);
    if (unit === 'k' || unit === 'K') value *= 1_000;
    if (unit === 'm' || unit === 'M') value *= 1_000_000;
    if (unit === 'b' || unit === 'B' || unit === 'bn') value *= 1_000_000_000;
    if (Number.isFinite(value)) out.push(String(value));
  }
  return out;
}

export type ClaimSources = {
  /** Every portfolio entry, approved or not: the check needs to know the unapproved ones to catch them. */
  entries: SavedEntry[];
  /** The text the draft may take numbers from besides approved entries: the job post and its questions. */
  jobTexts: string[];
};

/** The claim check itself: every flag the text raises, in the order its sentences come. Pure. */
export function checkClaims(text: string, sources: ClaimSources): ClaimFlag[] {
  const named = sources.entries
    .map((entry) => ({ entry, pattern: namePattern(entry.project) }))
    .filter((x): x is { entry: SavedEntry; pattern: RegExp } => x.pattern !== null);

  const grounded = new Set<string>();
  for (const t of sources.jobTexts) for (const n of numbersIn(t)) grounded.add(n);
  for (const e of sources.entries) {
    if (e.approvedForUse !== true) continue;
    for (const t of [e.project, e.features, ...e.links]) for (const n of numbersIn(t)) grounded.add(n);
  }

  const flags: ClaimFlag[] = [];
  for (const sentence of sentencesOf(text)) {
    const owned = clausesOwned(sentence, named);
    for (const { entry, pattern } of named) {
      if (!pattern.test(sentence)) continue;
      if (entry.approvedForUse !== true) {
        flags.push({
          kind: 'unapproved-evidence',
          sentence,
          why: `“${entry.project}” is not approved for use on your Portfolio page. Take it out, or approve the entry if it is true and you are happy to cite it.`,
        });
      }
      const said = owned.get(entry) ?? sentence;
      if (entry.status !== 'delivered' && !honestAboutStatus(said)) {
        const status = STATUS_LABELS[entry.status].toLowerCase();
        const presented = saysDone(said)
          ? 'this sentence presents it as finished'
          : 'this sentence does not say it is unfinished';
        flags.push({
          kind: 'planned-as-delivered',
          sentence,
          why: `“${entry.project}” is marked ${status} on your Portfolio page, but ${presented}. Say plainly that it is ${status}, or take it out.`,
        });
      }
    }
    const unsourced = [...new Set(numbersIn(sentence).filter((n) => !grounded.has(n)))];
    if (unsourced.length > 0) {
      flags.push({
        kind: 'invented-number',
        sentence,
        why: `${unsourced.length === 1 ? `The number ${unsourced[0]} appears` : `The numbers ${unsourced.join(', ')} appear`} nowhere in the job post or your approved portfolio entries. Take ${unsourced.length === 1 ? 'it' : 'them'} out, or add the fact to an approved entry if it is true.`,
      });
    }
  }
  return flags;
}

/** Whether a piece of a sentence says the work is finished, once honest phrases like "being built" are set aside. */
function saysDone(said: string): boolean {
  return DONE_WORDS.test(said.replace(NEGATED_DONE, ' '));
}

/** A piece of a sentence that says plainly the work is not finished, and nothing that says it is. */
function honestAboutStatus(said: string): boolean {
  const notYet = NOT_YET_WORDS.test(said) || new RegExp(NEGATED_DONE.source, 'i').test(said);
  return notYet && !saysDone(said);
}

/**
 * The part of a sentence that speaks about each project it names. The
 * sentence is cut into clauses (never inside a project's name); a clause
 * naming a project belongs to it, and a clause naming none belongs to the
 * project named most recently before it (or, before any is named, to the
 * first one named). So "Booking Helper, which I'm building now, syncs
 * calendars" is all about Booking Helper, "Booking Helper is planned, but I
 * already launched it" is too, and in "I delivered Clinic Dashboard and am
 * building Booking Helper" the "delivered" is Clinic Dashboard's alone.
 */
function clausesOwned<T>(sentence: string, named: { entry: T; pattern: RegExp }[]): Map<T, string> {
  const spans: { entry: T; start: number; end: number }[] = [];
  for (const { entry, pattern } of named) {
    const all = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const m of sentence.matchAll(all)) spans.push({ entry, start: m.index, end: m.index + m[0].length });
  }
  const breaks = [0];
  for (const m of sentence.matchAll(CLAUSE_BREAK)) {
    if (!spans.some((sp) => m.index < sp.end && m.index + m[0].length > sp.start)) breaks.push(m.index);
  }
  breaks.push(sentence.length);

  const clauses = breaks.slice(0, -1).map((start, i) => {
    const end = breaks[i + 1];
    const names = spans.filter((sp) => sp.start < end && sp.end > start).map((sp) => sp.entry);
    return { text: sentence.slice(start, end), names: [...new Set(names)] };
  });
  const firstNamed = clauses.find((c) => c.names.length > 0)?.names ?? [];
  const owned = new Map<T, string[]>();
  let current = firstNamed;
  for (const c of clauses) {
    if (c.names.length > 0) current = c.names;
    for (const e of current) owned.set(e, [...(owned.get(e) ?? []), c.text]);
  }
  return new Map([...owned].map(([e, parts]) => [e, parts.join(' ')]));
}

/** The job's own text the draft may take numbers from, plus Dane's own answers to its screening questions (his words, so his to cite). */
export function jobTextsOf(job: SavedJob, questions: string[]): string[] {
  return [job.title, job.description, job.budget ?? '', job.client ?? '', ...questions];
}

/**
 * Every flag on a proposal's draft as things stand now. An empty list when it
 * has no draft (there is nothing to approve then either) or no such proposal.
 */
export function proposalFlags(db: DatabaseSync, proposalId: number): ClaimFlag[] {
  const proposal = getProposal(db, proposalId);
  if (!proposal || proposal.draft === null) return [];
  const job = getJob(db, proposal.opportunityId);
  if (!job) return [];
  return checkClaims(proposal.draft, {
    entries: listEntries(db),
    jobTexts: jobTextsOf(job, proposal.questions.flatMap((q) => [q.question, q.answer ?? ''])),
  });
}

export type ApprovalBlock = { blocked: false } | { blocked: true; reasons: string[]; flags: ClaimFlag[] };

/**
 * Whether a proposal's draft may be approved: the one question approval
 * (task 3.3) must ask, and refuse on `blocked: true`. A proposal with no
 * draft, or one that cannot be found, is blocked too: there is nothing
 * checked to approve.
 */
export function approvalBlock(db: DatabaseSync, proposalId: number): ApprovalBlock {
  const proposal = getProposal(db, proposalId);
  if (!proposal) return { blocked: true, reasons: ['There is no such proposal.'], flags: [] };
  if (proposal.draft === null || !proposal.draft.trim()) return { blocked: true, reasons: ['There is no draft to approve yet.'], flags: [] };
  const flags = proposalFlags(db, proposalId);
  if (flags.length === 0) return { blocked: false };
  return {
    blocked: true,
    reasons: [`${flags.length} claim${flags.length === 1 ? '' : 's'} in the draft cannot be backed up yet.`],
    flags,
  };
}
