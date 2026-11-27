/**
 * A proposal's history (UB-26): every time its draft or its screening
 * questions and answers change, a copy of the whole proposal as it now
 * stands is kept, numbered 1, 2, 3. A copy can never be changed or deleted
 * afterwards: the database refuses (db/migrations/012_proposal_version.sql).
 *
 * `recordVersion` is called by every place that changes what Dane would send
 * (lib/draft.ts), inside the same transaction as the change, so a version
 * that fails to save takes the change down with it. A save that leaves the
 * proposal exactly as its last version adds nothing. Nothing is kept until
 * the proposal has a draft, so version 1 is always the first draft.
 *
 * It reads the tables directly rather than through lib/draft.ts, so the two
 * modules do not import each other.
 *
 * Nothing here imports Next.js, so the tests run it under `node --test`.
 */

import type { DatabaseSync } from 'node:sqlite';

export type VersionChange = 'first-draft' | 'draft' | 'answer' | 'question';
export type VersionAuthor = 'AI' | 'Dane';

export type ProposalVersion = {
  id: number;
  proposalId: number;
  versionNo: number;
  draft: string;
  /** [[question, answer], ...] in workspace order; an unanswered question has ''. */
  answers: [string, string][];
  change: VersionChange;
  author: VersionAuthor;
  savedAt: string;
};

const COLUMNS = 'id, proposal_id, version_no, draft, answers, change, author, saved_at';

function parseAnswers(raw: unknown): [string, string][] {
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.map((pair) => [String(pair?.[0] ?? ''), String(pair?.[1] ?? '')]);
  } catch {
    // The table refuses invalid JSON, so this is only a guard.
  }
  return [];
}

function toVersion(row: Record<string, unknown>): ProposalVersion {
  return {
    id: Number(row.id),
    proposalId: Number(row.proposal_id),
    versionNo: Number(row.version_no),
    draft: String(row.draft),
    answers: parseAnswers(row.answers),
    change: row.change as VersionChange,
    author: row.author as VersionAuthor,
    savedAt: String(row.saved_at),
  };
}

/** Every version of a proposal, oldest (version 1) first. Empty when it has none. */
export function proposalVersions(db: DatabaseSync, proposalId: number): ProposalVersion[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM proposal_version WHERE proposal_id = ? ORDER BY version_no`)
    .all(proposalId)
    .map(toVersion);
}

/** How many versions a proposal has, without reading their text. */
export function versionCount(db: DatabaseSync, proposalId: number): number {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM proposal_version WHERE proposal_id = ?').get(proposalId)?.n ?? 0);
}

/** The proposal's newest version, or undefined when it has none yet. */
export function latestVersion(db: DatabaseSync, proposalId: number): ProposalVersion | undefined {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM proposal_version WHERE proposal_id = ? ORDER BY version_no DESC LIMIT 1`)
    .get(proposalId);
  return row ? toVersion(row) : undefined;
}

/**
 * Keep a copy of the proposal as it stands right now, numbered one higher
 * than its last. Call it inside the transaction that made the change. Returns
 * the new version's number, or null when nothing was kept: the proposal has no
 * draft yet, or it is exactly as its last version. Throws if the copy cannot
 * be saved, so the caller's transaction rolls the change back.
 */
export function recordVersion(db: DatabaseSync, proposalId: number, change: VersionChange, author: VersionAuthor): number | null {
  const p = db.prepare('SELECT draft FROM proposal WHERE id = ?').get(proposalId);
  if (!p) throw new Error(`there is no proposal ${proposalId} to keep a version of`);
  if (p.draft === null || p.draft === undefined) return null;
  const draft = String(p.draft);
  const answers: [string, string][] = db
    .prepare('SELECT question, answer FROM proposal_question WHERE proposal_id = ? ORDER BY id')
    .all(proposalId)
    .map((q) => [String(q.question), (q.answer as string | null) ?? '']);

  const last = latestVersion(db, proposalId);
  if (last && last.draft === draft && JSON.stringify(last.answers) === JSON.stringify(answers)) return null;

  const versionNo = (last?.versionNo ?? 0) + 1;
  db.prepare('INSERT INTO proposal_version (proposal_id, version_no, draft, answers, change, author) VALUES (?, ?, ?, ?, ?, ?)').run(
    proposalId,
    versionNo,
    draft,
    JSON.stringify(answers),
    change,
    author,
  );
  return versionNo;
}

/**
 * Run `work` and the version it makes in one transaction: if either throws,
 * neither is saved. `work` returns false when it changed nothing (no such
 * proposal or question); then no version is kept either.
 */
export function changeWithVersion(
  db: DatabaseSync,
  proposalId: number,
  change: VersionChange,
  author: VersionAuthor,
  work: () => boolean,
): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const changed = work();
    if (changed) recordVersion(db, proposalId, change, author);
    db.exec('COMMIT');
    return changed;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
