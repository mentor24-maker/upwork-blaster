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
function isOnBoard(db: DatabaseSync, proposalId: number): boolean {
  return db.prepare('SELECT 1 FROM sent_record WHERE proposal_id = ? LIMIT 1').get(proposalId) !== undefined;
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
  if (!isOnBoard(db, proposalId)) return { ok: false, reason: 'not-sent' };
  const before = pipelineCard(db, proposalId);
  if (before?.status === status) return { ok: true, card: before, already: true };
  db.prepare('INSERT INTO pipeline_move (proposal_id, status) VALUES (?, ?)').run(proposalId, status);
  const card = pipelineCard(db, proposalId);
  if (card?.status !== status) throw new Error(`the move of proposal ${proposalId} to "${status}" did not read back after saving`);
  return { ok: true, card };
}

/** Add one note in his words. A blank note is refused; a long one is cut to MAX_NOTE. */
export function addNote(db: DatabaseSync, proposalId: number, note: string): PipelineResult {
  const text = note.replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTE);
  if (!text) return { ok: false, reason: 'empty' };
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
  const text = nextAction.trim().replace(/\s+/g, ' ').slice(0, MAX_NEXT_ACTION) || null;
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
