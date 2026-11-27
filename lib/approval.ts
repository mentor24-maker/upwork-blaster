/**
 * Approving one exact version of a proposal (task 3.3, hand-off §5D and
 * §13.6).
 *
 * The review screen shows Dane exactly what he would send: the draft's text,
 * every screening question with his answer, and anything still unresolved.
 * When he approves, the approval is bound to a **fingerprint** of what he was
 * shown: a SHA-256 hash of the exact text and every question and answer. The
 * page sends the fingerprint it showed with the click, so if anything changed
 * between the page loading and the click, the approval is refused rather than
 * attached to a version he did not read.
 *
 * Any later change cancels the approval. The database does that itself
 * (triggers in db/migrations/008_approval.sql), so no code path can forget,
 * and on top of that an approval only counts while the fingerprint of the
 * proposal as it is now still matches. Changing a word and changing it back
 * leaves it cancelled: he approves again.
 *
 * A proposal cannot be approved while anything blocks it: a claim the claim
 * check flags (lib/claimCheck.ts `approvalBlock`), or a screening question
 * with no answer. A flag that opens after approval (say a portfolio entry is
 * switched back to "not approved for use") puts the approval on hold until
 * it clears.
 *
 * Only Dane's signed-in click approves (app/api/approvals/route.ts checks the
 * sign-in itself, as well as the gate). `approve` is the one function that
 * writes an approval, and only that route calls it; the AI's drafting code
 * never does (a test pins both).
 *
 * Nothing here imports Next.js, so the tests run it under `node --test`.
 */

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { approvalBlock, type ClaimFlag } from './claimCheck.ts';
import { getProposal, unanswered, type SavedProposal } from './draft.ts';
import { logProposalActivity } from './activity.ts';

/** The fingerprint of a proposal's exact text and answers: 64 hex characters. */
export function fingerprintOf(p: Pick<SavedProposal, 'draft' | 'questions'>): string {
  const payload = JSON.stringify(['ub-approval-v1', p.draft ?? '', p.questions.map((q) => [q.question, q.answer ?? ''])]);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export const isFingerprint = (s: string) => /^[0-9a-f]{64}$/.test(s);

export type ReviewBlock = {
  blocked: boolean;
  /** Each thing in the way, in plain words. Empty when nothing is. */
  reasons: string[];
  /** The claim check's flags, for the screen to list. */
  flags: ClaimFlag[];
  /** The questions still waiting for an answer. */
  unansweredQuestions: string[];
};

/** Everything that stops a proposal being approved right now. */
export function reviewBlock(db: DatabaseSync, proposalId: number): ReviewBlock {
  const claims = approvalBlock(db, proposalId);
  const proposal = getProposal(db, proposalId);
  const open = proposal ? proposal.questions.filter(unanswered).map((q) => q.question) : [];
  const reasons = claims.blocked ? [...claims.reasons] : [];
  if (open.length > 0) {
    reasons.push(`${open.length} screening question${open.length === 1 ? ' has' : 's have'} no answer yet.`);
  }
  return {
    blocked: reasons.length > 0,
    reasons,
    flags: claims.blocked ? claims.flags : [],
    unansweredQuestions: open,
  };
}

export type SavedApproval = {
  id: number;
  proposalId: number;
  fingerprint: string;
  approvedDraft: string;
  approvedAnswers: [string, string][];
  approvedAt: string;
  cancelledAt: string | null;
  /** What changed: the draft, an answer, or a question added or removed. */
  cancelledWhy: 'draft' | 'answer' | 'question' | null;
};

function toApproval(row: Record<string, unknown>): SavedApproval {
  let answers: [string, string][] = [];
  try {
    const parsed = JSON.parse(String(row.approved_answers));
    if (Array.isArray(parsed)) answers = parsed.map((pair) => [String(pair?.[0] ?? ''), String(pair?.[1] ?? '')]);
  } catch {
    // The table refuses invalid JSON, so this is only a guard.
  }
  const why = row.cancelled_why;
  return {
    id: Number(row.id),
    proposalId: Number(row.proposal_id),
    fingerprint: String(row.fingerprint),
    approvedDraft: String(row.approved_draft),
    approvedAnswers: answers,
    approvedAt: String(row.approved_at),
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    cancelledWhy: why === 'draft' || why === 'answer' || why === 'question' ? why : null,
  };
}

/** The proposal's most recent approval, live or cancelled; undefined when it was never approved. */
export function latestApproval(db: DatabaseSync, proposalId: number): SavedApproval | undefined {
  const row = db
    .prepare(
      `SELECT id, proposal_id, fingerprint, approved_draft, approved_answers, approved_at, cancelled_at, cancelled_why
         FROM approval WHERE proposal_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(proposalId);
  return row ? toApproval(row) : undefined;
}

export type ApprovalState =
  | { state: 'none' }
  | { state: 'approved'; approval: SavedApproval }
  /** Something it covered changed after Dane approved: he must approve again. */
  | { state: 'cancelled'; approval: SavedApproval; why: string }
  /** The words are unchanged, but a flag has opened since: it counts again once that clears. */
  | { state: 'on-hold'; approval: SavedApproval; block: ReviewBlock };

const CANCELLED_WHY: Record<NonNullable<SavedApproval['cancelledWhy']>, string> = {
  draft: 'the draft’s text was changed after you approved it',
  answer: 'a screening answer was changed after you approved it',
  question: 'a screening question was added or removed after you approved it',
};

/**
 * Whether the proposal, as it is now, is approved. Worked out afresh on every
 * read: approved only when the latest approval was never cancelled, its
 * fingerprint is the proposal's fingerprint now, and nothing blocks it.
 */
export function approvalState(db: DatabaseSync, proposalId: number): ApprovalState {
  const approval = latestApproval(db, proposalId);
  const proposal = getProposal(db, proposalId);
  if (!approval || !proposal) return { state: 'none' };
  if (approval.cancelledAt !== null) {
    return { state: 'cancelled', approval, why: CANCELLED_WHY[approval.cancelledWhy ?? 'draft'] };
  }
  if (approval.fingerprint !== fingerprintOf(proposal)) {
    return { state: 'cancelled', approval, why: 'what you approved is no longer what the proposal says' };
  }
  const block = reviewBlock(db, proposalId);
  if (block.blocked) return { state: 'on-hold', approval, block };
  return { state: 'approved', approval };
}

export type ApproveResult =
  | { ok: true; approval: SavedApproval; already: boolean }
  | { ok: false; reason: 'not-found' | 'changed' | 'blocked'; block?: ReviewBlock };

/**
 * Record Dane's approval of the version he was shown, whose fingerprint is
 * `seenFingerprint`. Refused when there is no such proposal, when the
 * proposal no longer matches what he saw, or when anything blocks it.
 * Approving a version already approved changes nothing.
 *
 * Only the signed-in approval route (app/api/approvals/route.ts) calls this.
 */
export function approve(db: DatabaseSync, proposalId: number, seenFingerprint: string): ApproveResult {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = approveInside(db, proposalId, seenFingerprint);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function approveInside(db: DatabaseSync, proposalId: number, seenFingerprint: string): ApproveResult {
  const proposal = getProposal(db, proposalId);
  if (!proposal || proposal.draft === null) return { ok: false, reason: 'not-found' };
  const now = fingerprintOf(proposal);
  if (!isFingerprint(seenFingerprint) || seenFingerprint !== now) return { ok: false, reason: 'changed' };
  const block = reviewBlock(db, proposalId);
  if (block.blocked) return { ok: false, reason: 'blocked', block };

  const current = approvalState(db, proposalId);
  if (current.state === 'approved') return { ok: true, approval: current.approval, already: true };

  // An older approval that still stands (only possible on hold) gives way to this one.
  db.prepare(
    `UPDATE approval SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), cancelled_why = 'replaced'
      WHERE proposal_id = ? AND cancelled_at IS NULL`,
  ).run(proposalId);
  db.prepare('INSERT INTO approval (proposal_id, fingerprint, approved_draft, approved_answers) VALUES (?, ?, ?, ?)').run(
    proposalId,
    now,
    proposal.draft,
    JSON.stringify(proposal.questions.map((q) => [q.question, q.answer ?? ''])),
  );
  const saved = latestApproval(db, proposalId);
  if (!saved || saved.fingerprint !== now || saved.cancelledAt !== null) {
    throw new Error(`the approval of proposal ${proposalId} did not read back after saving`);
  }
  logProposalActivity(db, proposalId, 'Dane', 'draft-approved', (name) => `You approved this exact version of the proposal for ${name}.`);
  return { ok: true, approval: saved, already: false };
}
