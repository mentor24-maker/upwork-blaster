/**
 * "I sent it" (task 3.4, hand-off §13.11).
 *
 * The app never sends anything to Upwork. Dane copies an approved proposal
 * into Upwork himself, then presses "I sent it", and this records exactly
 * that: a send confirmed by Dane, with the time, never a send by the app
 * (`sent_by` can only say "Dane", db/migrations/009_sent.sql).
 *
 * Copying and marking sent are only offered on a proposal that is approved
 * right now (lib/approval.ts `approvalState`): not on one never approved, and
 * not on one whose approval was cancelled by an edit or put on hold by a flag.
 * The click carries the fingerprint of the version the screen showed, so the
 * mark lands on the version he copied or not at all.
 *
 * A send is tied to the approval it was sent under, so a later edit (which
 * cancels the approval) does not erase the record of what he sent.
 *
 * Only the signed-in sent route (app/api/sent/route.ts) calls `markSent`.
 * Nothing here imports Next.js, so the tests run it under `node --test`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { approvalState, isFingerprint, type SavedApproval } from './approval.ts';
import { logProposalActivity } from './activity.ts';

export type SentRecord = {
  id: number;
  proposalId: number;
  approvalId: number;
  /** Always "Dane": the app never sends. */
  sentBy: 'Dane';
  confirmedAt: string;
};

function toSent(row: Record<string, unknown>): SentRecord {
  return {
    id: Number(row.id),
    proposalId: Number(row.proposal_id),
    approvalId: Number(row.approval_id),
    sentBy: 'Dane',
    confirmedAt: String(row.confirmed_at),
  };
}

/** The proposal's most recent "I sent it", or undefined when he never marked it sent. */
export function latestSent(db: DatabaseSync, proposalId: number): SentRecord | undefined {
  const row = db
    .prepare(
      `SELECT id, proposal_id, approval_id, sent_by, confirmed_at
         FROM sent_record WHERE proposal_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(proposalId);
  return row ? toSent(row) : undefined;
}

/** What Dane copies into Upwork: the approved text and answers, byte for byte. */
export type CopyText = { draft: string; answers: { question: string; answer: string }[] };

/**
 * The text to copy, or undefined when copying is not offered: only while the
 * proposal is approved now. It comes from the approval record itself, the
 * exact version he approved.
 */
export function copyText(db: DatabaseSync, proposalId: number): CopyText | undefined {
  const state = approvalState(db, proposalId);
  if (state.state !== 'approved') return undefined;
  return fromApproval(state.approval);
}

const fromApproval = (a: SavedApproval): CopyText => ({
  draft: a.approvedDraft,
  answers: a.approvedAnswers.map(([question, answer]) => ({ question, answer })),
});

export type MarkSentResult =
  | { ok: true; sent: SentRecord; already: boolean }
  | { ok: false; reason: 'not-found' | 'not-approved' | 'changed' };

/**
 * Record Dane's word that he sent the version whose fingerprint is
 * `seenFingerprint`. Refused unless that exact version is approved now.
 * Marking the same approved version sent twice changes nothing.
 *
 * Only the signed-in sent route (app/api/sent/route.ts) calls this.
 */
export function markSent(db: DatabaseSync, proposalId: number, seenFingerprint: string): MarkSentResult {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = markSentInside(db, proposalId, seenFingerprint);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function markSentInside(db: DatabaseSync, proposalId: number, seenFingerprint: string): MarkSentResult {
  if (!db.prepare('SELECT 1 FROM proposal WHERE id = ?').get(proposalId)) return { ok: false, reason: 'not-found' };
  const state = approvalState(db, proposalId);
  if (state.state !== 'approved') return { ok: false, reason: 'not-approved' };
  if (!isFingerprint(seenFingerprint) || seenFingerprint !== state.approval.fingerprint) {
    return { ok: false, reason: 'changed' };
  }
  const prior = latestSent(db, proposalId);
  if (prior && prior.approvalId === state.approval.id) return { ok: true, sent: prior, already: true };

  db.prepare('INSERT INTO sent_record (proposal_id, approval_id) VALUES (?, ?)').run(proposalId, state.approval.id);
  const saved = latestSent(db, proposalId);
  if (!saved || saved.approvalId !== state.approval.id) {
    throw new Error(`the "I sent it" mark on proposal ${proposalId} did not read back after saving`);
  }
  logProposalActivity(db, proposalId, 'Dane', 'proposal-sent', (name) => `You marked the proposal for ${name} as sent on Upwork.`);
  return { ok: true, sent: saved, already: false };
}
