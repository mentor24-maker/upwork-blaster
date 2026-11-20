/**
 * Job posts Dane pastes in from Upwork (task 2.1). The app never fetches
 * anything from Upwork: every field here is what he typed or pasted.
 *
 * Nothing here imports Next.js, so the tests run it directly under
 * `node --test`. The form posts to app/api/jobs/route.ts, which calls
 * `readJobForm` then `saveJob`.
 *
 * A job is recognised by its link. Upwork writes the same job's link several
 * ways (with or without the title in it, with tracking after a "?"), so the
 * link is boiled down first: to the job's Upwork id when the link has one
 * (the "~01..." part), otherwise to the link without its "?" and "#" parts.
 */

import type { DatabaseSync } from 'node:sqlite';

export type JobType = 'fixed' | 'hourly';

export type NewJob = {
  url: string;
  title: string;
  description: string;
  budget: string | null;
  jobType: JobType | null;
  postedAt: string | null;
  client: string | null;
  connectsCost: number | null;
};

export type SavedJob = NewJob & {
  id: number;
  createdAt: string;
  /** When the AI read the post's fields (lib/extractJob.ts); null if it has not. */
  extractedAt: string | null;
  /** Why the AI could not read it, in plain words; null if nothing went wrong. */
  extractionProblem: string | null;
};

/** Why a form could not be saved; each has a plain message (jobFormMessage). */
export type JobFormError =
  | 'no-url'
  | 'bad-url'
  | 'no-title'
  | 'no-description'
  | 'too-long'
  | 'bad-job-type'
  | 'bad-connects'
  | 'duplicate';

const MESSAGES: Record<JobFormError, string> = {
  'no-url': 'Paste the job’s link from Upwork.',
  'bad-url': 'That link does not look like a web address. Copy it from the job’s page on Upwork (it starts with https://).',
  'no-title': 'Give the job its title.',
  'no-description': 'Paste the job post’s text.',
  'too-long': 'One of the fields is too long to be a single job post. Check what was pasted.',
  'bad-job-type': 'Pick fixed price, hourly, or leave the job type blank.',
  'bad-connects': 'Connects is a whole number, like 16, or blank when the post does not say.',
  duplicate: 'That job is already saved: the same link was saved before. Nothing new was saved.',
};

/** The message for an error code from the address, or null for anything else. */
export function jobFormMessage(code: string | string[] | undefined): string | null {
  const c = Array.isArray(code) ? code[0] : code;
  return c && Object.hasOwn(MESSAGES, c) ? MESSAGES[c as JobFormError] : null;
}

/** Field limits: generous for one post, small enough to catch a wrong paste. */
export const MAX_DESCRIPTION = 50_000;
export const MAX_FIELD = 2_000;

/**
 * The link boiled down to how a duplicate is recognised. Null when it is not
 * an http(s) address.
 */
export function normaliseJobUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'upwork.com' || host.endsWith('.upwork.com')) {
    // Upwork's job id: "~" then letters and digits, e.g. ~01a2b3c4d5e6f7a8b9.
    const id = /~([0-9a-z]{6,})/i.exec(decodeURIComponent(u.pathname));
    if (id) return `https://www.upwork.com/jobs/~${id[1].toLowerCase()}`;
  }
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}${path}`;
}

type FormLike = { get(name: string): unknown };

const text = (form: FormLike, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
};
const orNull = (s: string): string | null => (s === '' ? null : s);

/** The form's fields checked and tidied, or the first thing wrong with them. */
export function readJobForm(form: FormLike): { ok: true; job: NewJob } | { ok: false; error: JobFormError } {
  const rawUrl = text(form, 'url');
  if (!rawUrl) return { ok: false, error: 'no-url' };
  const url = normaliseJobUrl(rawUrl);
  if (!url || rawUrl.length > MAX_FIELD) return { ok: false, error: 'bad-url' };

  const title = text(form, 'title');
  if (!title) return { ok: false, error: 'no-title' };
  const description = text(form, 'description');
  if (!description) return { ok: false, error: 'no-description' };

  const budget = text(form, 'budget');
  const postedAt = text(form, 'posted_at');
  const client = text(form, 'client');
  if (description.length > MAX_DESCRIPTION || [title, budget, postedAt, client].some((s) => s.length > MAX_FIELD)) {
    return { ok: false, error: 'too-long' };
  }

  const jt = text(form, 'job_type');
  if (jt !== '' && jt !== 'fixed' && jt !== 'hourly') return { ok: false, error: 'bad-job-type' };

  const connects = text(form, 'connects_cost');
  if (connects !== '' && !/^\d{1,4}$/.test(connects)) return { ok: false, error: 'bad-connects' };

  return {
    ok: true,
    job: {
      url,
      title,
      description,
      budget: orNull(budget),
      jobType: jt === '' ? null : jt,
      postedAt: orNull(postedAt),
      client: orNull(client),
      connectsCost: connects === '' ? null : Number(connects),
    },
  };
}

/** The saved job with this (boiled-down) link, if there is one. */
export function findJobByUrl(db: DatabaseSync, url: string): SavedJob | undefined {
  const row = db.prepare(`${SELECT} WHERE url = ?`).get(url);
  return row ? toJob(row) : undefined;
}

/** Save a job. A second job with the same link is refused, and nothing changes. */
export function saveJob(
  db: DatabaseSync,
  job: NewJob,
): { ok: true; id: number } | { ok: false; error: 'duplicate'; existingId: number } {
  const existing = findJobByUrl(db, job.url);
  if (existing) return { ok: false, error: 'duplicate', existingId: existing.id };
  try {
    const result = db
      .prepare(
        `INSERT INTO opportunity (url, title, description, budget, job_type, posted_at, client, connects_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(job.url, job.title, job.description, job.budget, job.jobType, job.postedAt, job.client, job.connectsCost);
    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (err) {
    // Two saves of the same link at once: the table's UNIQUE rule is the last word.
    if (/UNIQUE/.test((err as Error).message)) {
      const again = findJobByUrl(db, job.url);
      if (again) return { ok: false, error: 'duplicate', existingId: again.id };
    }
    throw err;
  }
}

/** Every saved job, newest first. */
export function listJobs(db: DatabaseSync): SavedJob[] {
  return db.prepare(`${SELECT} ORDER BY created_at DESC, id DESC`).all().map(toJob);
}

const SELECT = `SELECT id, url, title, description, budget, job_type, posted_at, client, connects_cost, created_at, extracted_at, extraction_problem FROM opportunity`;

function toJob(row: Record<string, unknown>): SavedJob {
  return {
    id: Number(row.id),
    url: String(row.url),
    title: String(row.title),
    description: String(row.description),
    budget: (row.budget as string | null) ?? null,
    jobType: (row.job_type as JobType | null) ?? null,
    postedAt: (row.posted_at as string | null) ?? null,
    client: (row.client as string | null) ?? null,
    connectsCost: row.connects_cost == null ? null : Number(row.connects_cost),
    createdAt: String(row.created_at),
    extractedAt: (row.extracted_at as string | null) ?? null,
    extractionProblem: (row.extraction_problem as string | null) ?? null,
  };
}
