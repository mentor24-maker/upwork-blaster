/**
 * Reading a proposal's history (UB-29): every saved version
 * (lib/proposalVersions.ts), newest first, with the one Dane approved and the
 * one he sent marked, and any two compared side by side.
 *
 * The marks are worked out from the records that already exist, never stored
 * a second time. A version is "Approved" when its fingerprint
 * (lib/approval.ts `fingerprintOf`, the exact draft plus every question and
 * answer) is the fingerprint an `approval` row holds; it is "Sent" when a
 * `sent_record` points at that approval.
 *
 * Read only: nothing here writes to the database (a test counts every table's
 * rows before and after). It lives apart from lib/proposalVersions.ts because
 * it needs lib/approval.ts, which needs lib/draft.ts, which saves versions
 * through lib/proposalVersions.ts; keeping it separate keeps that chain from
 * looping back on itself.
 *
 * Nothing here imports Next.js, so the tests run it under `node --test`.
 */

import type { DatabaseSync } from 'node:sqlite';
import { fingerprintOf } from './approval.ts';
import { lineDiff, type DiffRow } from './diff.ts';
import { proposalVersions, type ProposalVersion } from './proposalVersions.ts';

export type ApprovalMark = {
  approvalId: number;
  approvedAt: string;
  /** True while the approval was never cancelled. */
  stands: boolean;
  cancelledAt: string | null;
  /** Why it was cancelled, in plain words; null while it stands. */
  cancelledWhy: string | null;
};

export type SentMark = { sentId: number; approvalId: number; confirmedAt: string };

export type MarkedVersion = ProposalVersion & {
  fingerprint: string;
  approvals: ApprovalMark[];
  sent: SentMark[];
};

export type VersionHistory = {
  /** Every version, newest first. */
  versions: MarkedVersion[];
  /** Approvals that match no saved version (say, one made before versions were kept). */
  unmatchedApprovals: ApprovalMark[];
  /** Sends whose approval matches no saved version, so no version in the list carries them. */
  unmatchedSent: SentMark[];
};

const CANCELLED_WHY: Record<string, string> = {
  draft: 'the draft’s text was changed afterwards',
  answer: 'a screening answer was changed afterwards',
  question: 'a screening question was added or removed afterwards',
  replaced: 'a newer approval replaced it',
};

/**
 * A version's fingerprint: the same hash an approval of that exact text would
 * hold. `fingerprintOf` reads only each question and answer, so the position
 * stands in for the question's id.
 */
export const versionFingerprint = (v: Pick<ProposalVersion, 'draft' | 'answers'>) =>
  fingerprintOf({ draft: v.draft, questions: v.answers.map(([question, answer], id) => ({ id, question, answer })) });

/** The whole history of a proposal, marked. Empty `versions` when it has none. */
export function versionHistory(db: DatabaseSync, proposalId: number): VersionHistory {
  const versions: MarkedVersion[] = proposalVersions(db, proposalId).map((v) => ({
    ...v,
    fingerprint: versionFingerprint(v),
    approvals: [],
    sent: [],
  }));

  const approvals = db
    .prepare('SELECT id, fingerprint, approved_at, cancelled_at, cancelled_why FROM approval WHERE proposal_id = ? ORDER BY id')
    .all(proposalId);
  const sends = db
    .prepare('SELECT id, approval_id, confirmed_at FROM sent_record WHERE proposal_id = ? ORDER BY id')
    .all(proposalId);

  const byApproval = new Map<number, MarkedVersion>();
  const unmatchedApprovals: ApprovalMark[] = [];
  for (const row of approvals) {
    const cancelledAt = (row.cancelled_at as string | null) ?? null;
    const mark: ApprovalMark = {
      approvalId: Number(row.id),
      approvedAt: String(row.approved_at),
      stands: cancelledAt === null,
      cancelledAt,
      cancelledWhy: cancelledAt === null ? null : (CANCELLED_WHY[String(row.cancelled_why)] ?? 'it was cancelled'),
    };
    // The same words can be saved twice (changed, then changed back): the
    // approval belongs to the newest matching version saved by the time he
    // approved, or failing that the newest matching one.
    const matching = versions.filter((v) => v.fingerprint === String(row.fingerprint));
    const version = matching.filter((v) => v.savedAt <= mark.approvedAt).at(-1) ?? matching.at(-1);
    if (version) {
      version.approvals.push(mark);
      byApproval.set(mark.approvalId, version);
    } else {
      unmatchedApprovals.push(mark);
    }
  }
  const unmatchedSent: SentMark[] = [];
  for (const row of sends) {
    const approvalId = Number(row.approval_id);
    const mark: SentMark = { sentId: Number(row.id), approvalId, confirmedAt: String(row.confirmed_at) };
    const version = byApproval.get(approvalId);
    if (version) version.sent.push(mark);
    else unmatchedSent.push(mark);
  }

  return { versions: versions.reverse(), unmatchedApprovals, unmatchedSent };
}

export type AnswerDiff = {
  question: string;
  /** 'both' when the question is in both versions; otherwise the one version that has it. */
  in: 'both' | 'older' | 'newer';
  rows: DiffRow[];
};

export type Comparison = {
  older: MarkedVersion;
  newer: MarkedVersion;
  draft: DiffRow[];
  answers: AnswerDiff[];
};

/**
 * Two versions side by side, the older on the left whichever way round they
 * were asked for. Undefined when either number is not a version of this
 * history, so a page never shows another proposal's text.
 */
export function compareVersions(history: VersionHistory, a: number, b: number): Comparison | undefined {
  const va = history.versions.find((v) => v.versionNo === a);
  const vb = history.versions.find((v) => v.versionNo === b);
  if (!va || !vb) return undefined;
  const [older, newer] = va.versionNo <= vb.versionNo ? [va, vb] : [vb, va];

  // A version keeps its answers in the order the questions were added, and a
  // question is never taken away, so the same position is the same question.
  // (Matching by wording would mix up two questions that read alike.)
  const answers: AnswerDiff[] = [];
  for (let k = 0; k < Math.max(older.answers.length, newer.answers.length); k++) {
    const before = older.answers[k];
    const after = newer.answers[k];
    answers.push({
      question: (after ?? before)[0],
      in: before && after ? 'both' : after ? 'newer' : 'older',
      rows: lineDiff(before?.[1] ?? '', after?.[1] ?? ''),
    });
  }
  return { older, newer, draft: lineDiff(older.draft, newer.draft), answers };
}

/** The pair shown when none is picked: the newest against the one before it (or itself, when there is one). */
export function defaultPair(history: VersionHistory): [number, number] | undefined {
  const [newest, before] = history.versions;
  if (!newest) return undefined;
  return [(before ?? newest).versionNo, newest.versionNo];
}
