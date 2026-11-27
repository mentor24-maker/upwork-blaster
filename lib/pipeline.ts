/**
 * The Pipeline board (task 3.5): after Dane marks a proposal "I sent it"
 * (lib/sent.ts), he tracks the job through replied, interviewing, won or
 * lost, with notes and a next action.
 *
 * Every status here is one he set. The app has no connection to Upwork and
 * never guesses: a job he marked sent sits in "Sent" until he moves it. Only
 * a proposal he marked sent is on the board, and only the signed-in pipeline
 * route (app/api/pipeline/route.ts) changes it.
 *
 * Moves and notes are kept, never edited (db/migrations/010_pipeline.sql);
 * the newest move is the status in force. The next action is one value he
 * replaces as things move.
 *
 * Nothing here imports Next.js, so the tests run it under `node --test`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { latestSent } from './sent.ts';
import { aiSpendSummary, type SpendSummary } from './ai/usage.ts';

export const PIPELINE_STATUSES = ['sent', 'replied', 'interviewing', 'won', 'lost'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PIPELINE_LABELS: Record<PipelineStatus, string> = {
  sent: 'Sent',
  replied: 'Replied',
  interviewing: 'Interviewing',
  won: 'Won',
  lost: 'Lost',
};

export const MAX_NOTE = 5_000;
export const MAX_NEXT_ACTION = 500;

export function isPipelineStatus(v: unknown): v is PipelineStatus {
  return typeof v === 'string' && (PIPELINE_STATUSES as readonly string[]).includes(v);
}

export type PipelineNote = { id: number; note: string; createdAt: string };

export type PipelineCard = {
  proposalId: number;
  opportunityId: number;
  title: string;
  url: string;
  /** When he first said he sent it. */
  sentAt: string;
  status: PipelineStatus;
  /** When he moved it to its status; the send time while it is still in "Sent" untouched. */
  statusSince: string;
  nextAction: string | null;
  /** Newest first. */
  notes: PipelineNote[];
};

export type PipelineBoard = { columns: { status: PipelineStatus; label: string; cards: PipelineCard[] }[]; total: number };

/** True when he has marked this proposal sent: only then is it on the board. */
const isOnBoard = (db: DatabaseSync, proposalId: number): boolean => latestSent(db, proposalId) !== undefined;

/**
 * Cut text to at most `max` whole characters. A plain `.slice` counts UTF-16
 * halves and can split an emoji in two, which the database stores as a broken
 * character; this never does.
 */
export function cutToChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

/**
 * Run one check-write-read-back as a single transaction, the way every other
 * writer in lib/ does (lib/sent.ts markSent): a read-back that fails undoes
 * the write, and two quick clicks cannot both pass the same check.
 */
function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** One job's card, or undefined when the proposal was never marked sent. */
export function pipelineCard(db: DatabaseSync, proposalId: number): PipelineCard | undefined {
  const row = db
    .prepare(
      `SELECT p.id AS proposal_id, o.id AS opportunity_id, o.title, o.url,
              (SELECT MIN(confirmed_at) FROM sent_record s WHERE s.proposal_id = p.id) AS sent_at
         FROM proposal p JOIN opportunity o ON o.id = p.opportunity_id
        WHERE p.id = ?`,
    )
    .get(proposalId);
  if (!row || row.sent_at === null || row.sent_at === undefined) return undefined;
  const move = db
    .prepare('SELECT status, moved_at FROM pipeline_move WHERE proposal_id = ? ORDER BY id DESC LIMIT 1')
    .get(proposalId);
  const next = db.prepare('SELECT next_action FROM pipeline_next_action WHERE proposal_id = ?').get(proposalId);
  const notes = db
    .prepare('SELECT id, note, created_at FROM pipeline_note WHERE proposal_id = ? ORDER BY id DESC')
    .all(proposalId)
    .map((n) => ({ id: Number(n.id), note: String(n.note), createdAt: String(n.created_at) }));
  const status = move && isPipelineStatus(move.status) ? move.status : 'sent';
  return {
    proposalId,
    opportunityId: Number(row.opportunity_id),
    title: String(row.title),
    url: String(row.url),
    sentAt: String(row.sent_at),
    status,
    statusSince: move ? String(move.moved_at) : String(row.sent_at),
    nextAction: (next?.next_action as string | null | undefined) ?? null,
    notes,
  };
}

/** Every job he marked sent, in its column; newest move first within a column. */
export function buildPipeline(db: DatabaseSync): PipelineBoard {
  const ids = db
    .prepare('SELECT DISTINCT proposal_id FROM sent_record ORDER BY proposal_id')
    .all()
    .map((r) => Number(r.proposal_id));
  const cards = ids.map((id) => pipelineCard(db, id)).filter((c): c is PipelineCard => c !== undefined);
  const columns = PIPELINE_STATUSES.map((status) => ({
    status,
    label: PIPELINE_LABELS[status],
    cards: cards
      .filter((c) => c.status === status)
      .sort((a, b) => (a.statusSince < b.statusSince ? 1 : a.statusSince > b.statusSince ? -1 : b.proposalId - a.proposalId)),
  }));
  return { columns, total: cards.length };
}

export type PipelineResult =
  | { ok: true; card: PipelineCard; already?: boolean }
  | { ok: false; reason: 'not-sent' | 'empty' };

/** Move a sent job to a status he picked. Moving it to the status it is already in changes nothing. */
export function moveJob(db: DatabaseSync, proposalId: number, status: PipelineStatus): PipelineResult {
  if (!isPipelineStatus(status)) throw new Error(`not a pipeline status: ${String(status)}`);
  return inTransaction(db, () => moveJobInside(db, proposalId, status));
}

function moveJobInside(db: DatabaseSync, proposalId: number, status: PipelineStatus): PipelineResult {
  if (!isOnBoard(db, proposalId)) return { ok: false, reason: 'not-sent' };
  const before = pipelineCard(db, proposalId);
  if (before?.status === status) return { ok: true, card: before, already: true };
  db.prepare('INSERT INTO pipeline_move (proposal_id, status) VALUES (?, ?)').run(proposalId, status);
  const card = pipelineCard(db, proposalId);
  if (card?.status !== status) throw new Error(`the move of proposal ${proposalId} to "${status}" did not read back after saving`);
  return { ok: true, card };
}

/** Add one note in his words. A blank note is refused; a long one is cut to MAX_NOTE whole characters. */
export function addNote(db: DatabaseSync, proposalId: number, note: string): PipelineResult {
  const text = cutToChars(note.replace(/\r\n/g, '\n').trim(), MAX_NOTE);
  if (!text) return { ok: false, reason: 'empty' };
  return inTransaction(db, () => addNoteInside(db, proposalId, text));
}

function addNoteInside(db: DatabaseSync, proposalId: number, text: string): PipelineResult {
  if (!isOnBoard(db, proposalId)) return { ok: false, reason: 'not-sent' };
  const id = Number(db.prepare('INSERT INTO pipeline_note (proposal_id, note) VALUES (?, ?)').run(proposalId, text).lastInsertRowid);
  const card = pipelineCard(db, proposalId);
  if (!card?.notes.some((n) => n.id === id && n.note === text)) {
    throw new Error(`the note on proposal ${proposalId} did not read back after saving`);
  }
  return { ok: true, card };
}

/** Set (or, when blank, clear) the job's one next action. */
export function setNextAction(db: DatabaseSync, proposalId: number, nextAction: string): PipelineResult {
  const text = cutToChars(nextAction.trim().replace(/\s+/g, ' '), MAX_NEXT_ACTION) || null;
  return inTransaction(db, () => setNextActionInside(db, proposalId, text));
}

function setNextActionInside(db: DatabaseSync, proposalId: number, text: string | null): PipelineResult {
  if (!isOnBoard(db, proposalId)) return { ok: false, reason: 'not-sent' };
  db.prepare(
    `INSERT INTO pipeline_next_action (proposal_id, next_action) VALUES (?, ?)
       ON CONFLICT (proposal_id) DO UPDATE SET next_action = excluded.next_action,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(proposalId, text);
  const card = pipelineCard(db, proposalId);
  if (!card || card.nextAction !== text) throw new Error(`the next action on proposal ${proposalId} did not read back after saving`);
  return { ok: true, card };
}

// ---------------------------------------------------------------- the form

type FormLike = { get(name: string): unknown };

export type PipelineAction =
  | { proposalId: number; action: 'move'; status: PipelineStatus }
  | { proposalId: number; action: 'note'; text: string }
  | { proposalId: number; action: 'next'; text: string };

/** The board form's fields checked, or null when they are not one of its three actions on a proposal. */
export function readPipelineForm(form: FormLike): PipelineAction | null {
  const p = form.get('proposal');
  const action = form.get('action');
  if (typeof p !== 'string' || !/^\d{1,12}$/.test(p)) return null;
  const proposalId = Number(p);
  if (action === 'move') {
    const status = form.get('status');
    return isPipelineStatus(status) ? { proposalId, action, status } : null;
  }
  if (action === 'note' || action === 'next') {
    const text = form.get('text');
    return typeof text === 'string' ? { proposalId, action, text } : null;
  }
  return null;
}

/** Carry out one checked form action. */
export function applyPipelineAction(db: DatabaseSync, a: PipelineAction): PipelineResult {
  if (a.action === 'move') return moveJob(db, a.proposalId, a.status);
  if (a.action === 'note') return addNote(db, a.proposalId, a.text);
  return setNextAction(db, a.proposalId, a.text);
}

// ---------------------------------------------------------------- outcomes

/**
 * The Outcomes numbers at the top of the board (task 6.4). Read-only: worked
 * out from `sent_record` and `pipeline_move`, never written.
 *
 * How each count is decided (one rule):
 *  - **Sent**: every proposal he marked "I sent it" (the same set the board shows).
 *  - **Replied / Interviewing**: a job counts once if its move history ever
 *    reached that status. A job moved to Replied and back to Sent still counts
 *    as replied, once, however many times it moved.
 *  - **Won / Lost**: the status in force now (its newest move), so a job moved
 *    to Won by mistake and then back is not counted as won.
 *
 * Rates are whole percentages of the sent count, and absent (null) when
 * nothing was sent, never NaN. The AI spend is an estimate from the price
 * table (lib/ai/pricing.ts), kept apart from the measured counts.
 */
export type PipelineOutcomes = {
  sent: number;
  replied: number;
  interviewing: number;
  won: number;
  lost: number;
  /** Whole percentages of `sent`; null when nothing was sent. */
  replyRate: number | null;
  winRate: number | null;
  /** Estimated, from the price table: the total covers priced calls only. */
  spend: SpendSummary;
  /** spend.costUsd ÷ sent; null when nothing was sent. */
  spendPerSentUsd: number | null;
};

export function pipelineOutcomes(db: DatabaseSync): PipelineOutcomes {
  const ids = db
    .prepare('SELECT DISTINCT proposal_id FROM sent_record ORDER BY proposal_id')
    .all()
    .map((r) => Number(r.proposal_id));
  const reached = db.prepare('SELECT 1 AS hit FROM pipeline_move WHERE proposal_id = ? AND status = ? LIMIT 1');
  const newest = db.prepare('SELECT status FROM pipeline_move WHERE proposal_id = ? ORDER BY id DESC LIMIT 1');
  const everReached = (id: number, status: PipelineStatus) => reached.get(id, status) !== undefined;
  const nowIn = (id: number): PipelineStatus => {
    const move = newest.get(id);
    return move && isPipelineStatus(move.status) ? move.status : 'sent';
  };
  const sent = ids.length;
  const replied = ids.filter((id) => everReached(id, 'replied')).length;
  const interviewing = ids.filter((id) => everReached(id, 'interviewing')).length;
  const won = ids.filter((id) => nowIn(id) === 'won').length;
  const lost = ids.filter((id) => nowIn(id) === 'lost').length;
  const rate = (count: number) => (sent === 0 ? null : Math.round((count / sent) * 100));
  const spend = aiSpendSummary(db);
  return {
    sent,
    replied,
    interviewing,
    won,
    lost,
    replyRate: rate(replied),
    winRate: rate(won),
    spend,
    spendPerSentUsd: sent === 0 ? null : spend.costUsd / sent,
  };
}

const dollars = (usd: number) => (usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
const callCount = (count: number) => `${count} call${count === 1 ? '' : 's'}`;

/** The Outcomes section in plain words: measured lines and estimated lines, never mixed in one line. */
export function outcomeLines(o: PipelineOutcomes): { measured: string[]; estimated: string[] } {
  if (o.sent === 0 || o.replyRate === null || o.winRate === null || o.spendPerSentUsd === null) {
    return { measured: ['No proposals sent yet.'], estimated: [] };
  }
  const measured = [
    `Sent: ${o.sent} · Replied: ${o.replied} · Interviewing: ${o.interviewing} · Won: ${o.won} · Lost: ${o.lost}`,
    `Reply rate: ${o.replyRate}% (${o.replied} of ${o.sent})`,
    `Win rate: ${o.winRate}% (${o.won} of ${o.sent})`,
  ];
  const s = o.spend;
  const why = 'Worked out from the price table in the app (lib/ai/pricing.ts), not from a bill.';
  const estimated = [
    `AI spend per sent proposal: ${dollars(o.spendPerSentUsd)} (${dollars(s.costUsd)} across ${callCount(s.pricedCalls)}, ÷ ${o.sent} sent)`,
    s.unpricedCalls === 0
      ? why
      : `${why} Plus ${callCount(s.unpricedCalls)} not priced (${s.unpricedModels.join(', ')} has no price on record), so the real total is higher.`,
  ];
  return { measured, estimated };
}
