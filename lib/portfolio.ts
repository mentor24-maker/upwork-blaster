/**
 * Portfolio evidence (task 2.3): the projects and facts a proposal is allowed
 * to cite. Dane enters his own in the app; nothing real lives in the
 * repository (plan D7).
 *
 * Only entries he has switched to "approved for use" may ever reach a draft:
 * `approvedEvidence` is the one helper drafting (task 3.1) reads, and it
 * returns nothing else.
 *
 * Nothing here imports Next.js, so the tests run it directly under
 * `node --test`. The page's forms post to app/api/portfolio/route.ts, which
 * calls `readPortfolioForm` then `addEntry` / `updateEntry`, or `removeEntry`.
 * The table is `portfolio_evidence` (db/migrations/001_first_tables.sql).
 */

import type { DatabaseSync } from 'node:sqlite';
import { logActivity, MAX_TITLE } from './activity.ts';

/** The three statuses, in the order the form offers them. */
export const STATUSES = ['delivered', 'in progress', 'planned'] as const;
export type EvidenceStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<EvidenceStatus, string> = {
  delivered: 'Delivered',
  'in progress': 'In progress',
  planned: 'Planned',
};

export type NewEntry = {
  project: string;
  status: EvidenceStatus;
  features: string;
  links: string[];
  approvedForUse: boolean;
};

export type SavedEntry = NewEntry & { id: number; createdAt: string; updatedAt: string };

/** Limits: plenty for a real project, small enough to catch a wrong paste. */
export const MAX_PROJECT = 200;
export const MAX_FEATURES = 5_000;
export const MAX_LINKS = 20;
export const MAX_LINK = 2_000;

/** Why the form could not be saved; each has a plain message (portfolioFormMessage). */
export type PortfolioFormError = 'no-project' | 'bad-status' | 'bad-link' | 'too-many-links' | 'too-long' | 'not-found';

const MESSAGES: Record<PortfolioFormError, string> = {
  'no-project': 'Give the project a name. Nothing was saved.',
  'bad-status': 'Pick delivered, in progress or planned. Nothing was saved.',
  'bad-link': 'Each link must be a web address starting with https:// or http://, one per line. Nothing was saved.',
  'too-many-links': `An entry can hold at most ${MAX_LINKS} links. Nothing was saved.`,
  'too-long': 'One of the fields is too long for a single entry. Check what was pasted. Nothing was saved.',
  'not-found': 'That entry is no longer there (it may have been removed already). Nothing was changed.',
};

/** The message for an error code from the address, or null for anything else. */
export function portfolioFormMessage(code: string | string[] | undefined): string | null {
  const c = Array.isArray(code) ? code[0] : code;
  return c && Object.hasOwn(MESSAGES, c) ? MESSAGES[c as PortfolioFormError] : null;
}

type FormLike = { get(name: string): unknown };

const text = (form: FormLike, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

/** A link kept only when it is an http(s) address, so the page never shows another kind. */
function readLink(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
}

/** The form's fields checked and tidied, or the first thing wrong with them. */
export function readPortfolioForm(
  form: FormLike,
): { ok: true; entry: NewEntry } | { ok: false; error: PortfolioFormError } {
  const project = text(form, 'project').trim().replace(/\s+/g, ' ');
  if (!project) return { ok: false, error: 'no-project' };
  if (project.length > MAX_PROJECT) return { ok: false, error: 'too-long' };

  const status = text(form, 'status');
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'bad-status' };

  const features = text(form, 'features').replace(/\r\n/g, '\n').trim();
  if (features.length > MAX_FEATURES) return { ok: false, error: 'too-long' };

  const links: string[] = [];
  for (const line of text(form, 'links').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    if (raw.length > MAX_LINK) return { ok: false, error: 'too-long' };
    const link = readLink(raw);
    if (!link) return { ok: false, error: 'bad-link' };
    if (!links.includes(link)) links.push(link);
  }
  if (links.length > MAX_LINKS) return { ok: false, error: 'too-many-links' };

  // A checkbox sends its value only when ticked.
  const approvedForUse = form.get('approvedForUse') != null;

  return { ok: true, entry: { project, status: status as EvidenceStatus, features, links, approvedForUse } };
}

/** Add an entry and return its id. */
export function addEntry(db: DatabaseSync, entry: NewEntry): number {
  const result = db
    .prepare('INSERT INTO portfolio_evidence (project, status, features, links, approved_for_use) VALUES (?, ?, ?, ?, ?)')
    .run(entry.project, entry.status, entry.features, JSON.stringify(entry.links), entry.approvedForUse ? 1 : 0);
  logActivity(db, { actor: 'Dane', kind: 'portfolio-added', summary: `You added “${entry.project.slice(0, MAX_TITLE)}” to your portfolio.` });
  return Number(result.lastInsertRowid);
}

/** Replace an entry's fields. False when there is no entry with that id. */
export function updateEntry(db: DatabaseSync, id: number, entry: NewEntry): boolean {
  const result = db
    .prepare(
      `UPDATE portfolio_evidence
         SET project = ?, status = ?, features = ?, links = ?, approved_for_use = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .run(entry.project, entry.status, entry.features, JSON.stringify(entry.links), entry.approvedForUse ? 1 : 0, id);
  if (Number(result.changes) !== 1) return false;
  logActivity(db, { actor: 'Dane', kind: 'portfolio-updated', summary: `You updated “${entry.project.slice(0, MAX_TITLE)}” in your portfolio.` });
  return true;
}

/** Remove an entry for good. False when there is no entry with that id. */
export function removeEntry(db: DatabaseSync, id: number): boolean {
  const entry = getEntry(db, id);
  if (!entry || Number(db.prepare('DELETE FROM portfolio_evidence WHERE id = ?').run(id).changes) !== 1) return false;
  logActivity(db, { actor: 'Dane', kind: 'portfolio-removed', summary: `You removed “${entry.project.slice(0, MAX_TITLE)}” from your portfolio.` });
  return true;
}

/** One entry by id, or undefined. */
export function getEntry(db: DatabaseSync, id: number): SavedEntry | undefined {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id);
  return row ? toSaved(row) : undefined;
}

/** Every entry, approved or not, oldest first: what the Portfolio page shows. */
export function listEntries(db: DatabaseSync): SavedEntry[] {
  return db.prepare(`${SELECT} ORDER BY id`).all().map(toSaved);
}

/**
 * The evidence a proposal may cite: only entries approved for use, oldest
 * first. Drafting (task 3.1) reads this and nothing else from the portfolio.
 */
export function approvedEvidence(db: DatabaseSync): SavedEntry[] {
  return db.prepare(`${SELECT} WHERE approved_for_use = 1 ORDER BY id`).all().map(toSaved);
}

const SELECT = 'SELECT id, project, status, features, links, approved_for_use, created_at, updated_at FROM portfolio_evidence';

function toSaved(row: Record<string, unknown>): SavedEntry {
  let links: string[] = [];
  try {
    const parsed = JSON.parse(String(row.links));
    if (Array.isArray(parsed)) links = parsed.filter((x): x is string => typeof x === 'string' && readLink(x) !== null);
  } catch {
    // The table refuses invalid JSON, so this is only a guard.
  }
  return {
    id: Number(row.id),
    project: String(row.project),
    status: row.status as EvidenceStatus,
    features: String(row.features),
    links,
    approvedForUse: Number(row.approved_for_use) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
