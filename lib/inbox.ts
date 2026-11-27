/**
 * The Inbox (task 2.6, hand-off §5B): every saved job as a ranked card, top
 * five first, and Dane's Pursue, Pass or Revisit on each one.
 *
 * A decision is a new row in the `decision` table each time
 * (db/migrations/005_decision.sql); the newest is the one in force. A passed
 * job leaves the inbox but stays findable in its own list. Deciding never
 * touches his preferences or a job's score: nothing here writes to any table
 * but `decision`, and a test pins that.
 *
 * Nothing here imports Next.js, so the tests run it directly under
 * `node --test`. The card buttons post to app/api/decisions/route.ts.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { SavedJob } from './jobs.ts';
import { getJob, listJobs } from './jobs.ts';
import type { Confidence, Exclusion, SavedEvaluation } from './score.ts';
import { latestEvaluations, rankEvaluations } from './score.ts';
import { logJobActivity } from './activity.ts';

export const DECISIONS = ['pursue', 'pass', 'revisit'] as const;
export type DecisionKind = (typeof DECISIONS)[number];

export const DECISION_LABELS: Record<DecisionKind, string> = {
  pursue: 'Pursuing',
  pass: 'Passed',
  revisit: 'Revisit later',
};

export type SavedDecision = {
  id: number;
  opportunityId: number;
  decision: DecisionKind;
  reason: string | null;
  createdAt: string;
};

/** How many cards are shown first; the rest sit under "More jobs". */
export const TOP_COUNT = 5;
export const MAX_REASON = 500;

export function isDecision(v: unknown): v is DecisionKind {
  return typeof v === 'string' && (DECISIONS as readonly string[]).includes(v);
}

/**
 * Record a decision on a saved job and return it as read back from the table,
 * or undefined when there is no such job. A blank reason is stored as none.
 */
export function recordDecision(
  db: DatabaseSync,
  opportunityId: number,
  decision: DecisionKind,
  reason: string | null = null,
): SavedDecision | undefined {
  if (!isDecision(decision)) throw new Error(`not a decision: ${String(decision)}`);
  if (!getJob(db, opportunityId)) return undefined;
  const why = reason?.trim().replace(/\s+/g, ' ').slice(0, MAX_REASON) || null;
  const result = db
    .prepare('INSERT INTO decision (opportunity_id, decision, reason) VALUES (?, ?, ?)')
    .run(opportunityId, decision, why);
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(Number(result.lastInsertRowid));
  if (!row) throw new Error(`the decision on job ${opportunityId} did not read back after saving`);
  const saved = toDecision(row);
  const said = {
    pursue: (name: string) => `You chose to pursue ${name}.`,
    pass: (name: string) => `You passed on ${name}.`,
    revisit: (name: string) => `You marked ${name} to revisit later.`,
  }[saved.decision];
  logJobActivity(db, opportunityId, 'Dane', 'decision', said);
  return saved;
}

/** The decision in force for one job: its newest, if any. */
export function latestDecision(db: DatabaseSync, opportunityId: number): SavedDecision | undefined {
  const row = db.prepare(`${SELECT} WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1`).get(opportunityId);
  return row ? toDecision(row) : undefined;
}

/** Every job's decision in force, by job id. */
export function latestDecisions(db: DatabaseSync): Map<number, SavedDecision> {
  const rows = db
    .prepare(`${SELECT} WHERE id IN (SELECT MAX(id) FROM decision GROUP BY opportunity_id)`)
    .all()
    .map(toDecision);
  return new Map(rows.map((d) => [d.opportunityId, d]));
}

/** One decision by its id. */
export function getDecision(db: DatabaseSync, id: number): SavedDecision | undefined {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id);
  return row ? toDecision(row) : undefined;
}

/** One job's history of decisions, oldest first. */
export function decisionHistory(db: DatabaseSync, opportunityId: number): SavedDecision[] {
  return db.prepare(`${SELECT} WHERE opportunity_id = ? ORDER BY id`).all(opportunityId).map(toDecision);
}

const SELECT = 'SELECT id, opportunity_id, decision, reason, created_at FROM decision';

function toDecision(row: Record<string, unknown>): SavedDecision {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    decision: row.decision as DecisionKind,
    reason: (row.reason as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

// ---------------------------------------------------------------- the cards

export type Card = {
  job: SavedJob;
  /** 1 is the best; null for a job that is not ranked (passed, excluded, not scored). */
  rank: number | null;
  score: number | null;
  confidence: Confidence | null;
  /** The five parts of the score, each with its reasons. Empty when not scored. */
  reasons: { label: string; weight: number; score: number; evidence: string[] }[];
  /** The job's first sentence or so, as written: what the client needs. */
  need: string;
  /** The approved portfolio project that matched best, or null when none did. */
  portfolioEvidence: string | null;
  /** The biggest thing the app did not know, or null when it knew everything it weighs. */
  principalUncertainty: string | null;
  /**
   * How much of Dane's own time the job would take, as a range. Not estimated
   * yet (that is later work, plan 4.5), so always null: shown as "unknown",
   * never made up.
   */
  humanInvolvement: string | null;
  flags: string[];
  exclusions: Exclusion[];
  decision: SavedDecision | null;
};

export type Inbox = {
  /** The best TOP_COUNT jobs not passed, highest score first. */
  top: Card[];
  /** The rest of the ranked jobs not passed, in order. */
  more: Card[];
  /** Jobs that met a hard exclusion: listed apart with the reason, never ranked. */
  excluded: Card[];
  /** Jobs with no score (scoring failed, or not scored yet). */
  notScored: Card[];
  /** Jobs he passed on, newest decision first. Out of the inbox, still findable. */
  passed: Card[];
};

/** The first sentence or so of the post, cut to a card's length. */
export function needOf(description: string, max = 220): string {
  const text = description.replace(/\s+/g, ' ').trim();
  const first = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

function card(job: SavedJob, ev: SavedEvaluation | undefined, decision: SavedDecision | undefined, rank: number | null): Card {
  const fit = ev?.dimensions.find((d) => d.key === 'fit');
  const portfolio = fit?.evidence.find((line) => /^Your (delivered|in-progress) project /.test(line)) ?? null;
  // Unknowns from the heaviest dimension first: that is the one the score leans on most.
  const byWeight = [...(ev?.dimensions ?? [])].sort((a, b) => b.weight - a.weight);
  const principal = byWeight.flatMap((d) => d.unknowns)[0] ?? ev?.unknowns[0] ?? null;
  return {
    job,
    rank,
    score: ev?.score ?? null,
    confidence: ev?.confidence ?? null,
    reasons: (ev?.dimensions ?? []).map((d) => ({ label: d.label, weight: d.weight, score: d.score, evidence: d.evidence })),
    need: needOf(job.description),
    portfolioEvidence: portfolio,
    principalUncertainty: principal,
    humanInvolvement: null,
    flags: ev?.flags ?? [],
    exclusions: ev?.exclusions ?? [],
    decision: decision ?? null,
  };
}

/** Every saved job sorted onto the Inbox: read only, it writes nothing. */
export function buildInbox(db: DatabaseSync): Inbox {
  const jobs = new Map(listJobs(db).map((j) => [j.id, j]));
  const evaluations = latestEvaluations(db).filter((e) => jobs.has(e.opportunityId));
  const decisions = latestDecisions(db);
  const isPassed = (id: number) => decisions.get(id)?.decision === 'pass';

  const { ranked, setAside } = rankEvaluations(evaluations.filter((e) => !isPassed(e.opportunityId)));
  const live = ranked.map((e, i) => card(jobs.get(e.opportunityId)!, e, decisions.get(e.opportunityId), i + 1));

  const scored = new Set(evaluations.map((e) => e.opportunityId));
  const evalOf = new Map(evaluations.map((e) => [e.opportunityId, e]));
  const passed = [...jobs.values()]
    .filter((j) => isPassed(j.id))
    .map((j) => card(j, evalOf.get(j.id), decisions.get(j.id), null))
    .sort((a, b) => b.decision!.id - a.decision!.id);

  return {
    top: live.slice(0, TOP_COUNT),
    more: live.slice(TOP_COUNT),
    excluded: setAside
      .filter((e) => e.excluded)
      .map((e) => card(jobs.get(e.opportunityId)!, e, decisions.get(e.opportunityId), null)),
    notScored: [...jobs.values()]
      .filter((j) => !scored.has(j.id) && !isPassed(j.id))
      .map((j) => card(j, undefined, decisions.get(j.id), null)),
    passed,
  };
}

// ---------------------------------------------------------------- the form

type FormLike = { get(name: string): unknown };

/** The card form's fields checked, or null when they are not a decision on a job. */
export function readDecisionForm(form: FormLike): { opportunityId: number; decision: DecisionKind; reason: string | null } | null {
  const id = form.get('id');
  const decision = form.get('decision');
  const reason = form.get('reason');
  if (typeof id !== 'string' || !/^\d{1,12}$/.test(id) || !isDecision(decision)) return null;
  return { opportunityId: Number(id), decision, reason: typeof reason === 'string' ? reason : null };
}
