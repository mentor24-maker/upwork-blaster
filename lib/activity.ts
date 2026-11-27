/**
 * The activity log (the /activity page): one plain-English line for each
 * thing Dane or the AI did, newest first, so he can look back and see what
 * happened and who did it.
 *
 * Each save writes its own line, from inside the function that does the save
 * (lib/jobs.ts, lib/draft.ts, lib/pipeline.ts and the rest), so every way in
 * is covered. The wording is fixed; the only words taken from his data are a
 * job's title or a portfolio project's name. Even so, every line is scrubbed
 * before it is written: the app password, the session key, the AI key, a
 * session cookie value or anything shaped like a Claude key becomes
 * "[hidden]". This repository is public and the log is shown on a page, so a
 * secret must never reach it.
 *
 * A secret is hidden BEFORE any text is cut short or squashed onto one
 * line, so a secret that falls across the cut, or has a space or a line
 * break inside it, is still hidden whole (`quotedName`, `logActivity`).
 *
 * One kind of line can be written by someone who is not signed in: a refused
 * sign-in. So that a script guessing passwords cannot push Dane's real
 * history off the page, refusals in a row share one line that counts them
 * (`logRepeatedActivity`); the next thing anyone does starts a fresh line.
 *
 * Writing the line never costs Dane his save: if it cannot be written, the
 * save stands and the failure goes to the app's own log (CLAUDE.md: a step
 * that fails says so).
 */

import type { DatabaseSync } from 'node:sqlite';

export const ACTORS = ['Dane', 'AI', 'app'] as const;
export type Actor = (typeof ACTORS)[number];

export const ACTOR_LABELS: Record<Actor, string> = { Dane: 'You', AI: 'The AI', app: 'The app' };

export type NewEvent = {
  actor: Actor;
  kind: string;
  summary: string;
  opportunityId?: number | null;
  proposalId?: number | null;
};

export type ActivityEvent = {
  id: number;
  at: string;
  actor: Actor;
  kind: string;
  summary: string;
  opportunityId: number | null;
  proposalId: number | null;
};

export const MAX_SUMMARY = 500;
export const MAX_TITLE = 120;
export const HIDDEN = '[hidden]';
export const DEFAULT_LIMIT = 500;

type Env = Record<string, string | undefined>;

// The app's own secrets, by the names Doppler gives them.
const SECRET_NAMES = ['APP_PASSWORD', 'APP_SESSION_SECRET', 'ANTHROPIC_API_KEY'] as const;
// Shapes a secret takes even when it is not one of ours: a Claude key, and a
// session cookie value ("<issued-at ms>.<signature>", lib/session.ts).
const SECRET_SHAPES = [/sk-ant-[A-Za-z0-9_-]+/g, /\b\d{10,16}\.[A-Za-z0-9_-]{40,}/g];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with every secret in it replaced by "[hidden]". */
export function scrubSecrets(text: string, env: Env = process.env): string {
  let out = text;
  for (const name of SECRET_NAMES) {
    const value = env[name];
    // A value this short would hide ordinary words; the app refuses one anyway.
    if (value && value.length >= 4) out = out.replace(new RegExp(escape(value), 'g'), HIDDEN);
  }
  for (const shape of SECRET_SHAPES) out = out.replace(shape, HIDDEN);
  return out;
}

/** One line of text, at most `max` whole characters, with "…" when cut. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`;
}

/** Write one line. Never throws: a failure is reported to the app's log and the save it describes stands. */
export function logActivity(db: DatabaseSync, event: NewEvent): void {
  try {
    const summary = oneLine(scrubSecrets(event.summary), MAX_SUMMARY);
    db.prepare('INSERT INTO activity_event (actor, kind, summary, opportunity_id, proposal_id) VALUES (?, ?, ?, ?, ?)').run(
      event.actor,
      event.kind,
      summary,
      event.opportunityId ?? null,
      event.proposalId ?? null,
    );
  } catch (err) {
    console.error(`the activity log line "${event.kind}" could not be written: ${(err as Error).message}`);
  }
}

/**
 * Write a line that may repeat, such as a refused sign-in. When the newest
 * line of all is already one of this kind, it is counted again instead of
 * adding another: its count goes up, its time becomes now, and its wording
 * comes from `say(times)`. Never throws, like `logActivity`.
 */
export function logRepeatedActivity(db: DatabaseSync, event: Omit<NewEvent, 'summary'>, say: (times: number) => string): void {
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const newest = db.prepare('SELECT id, kind, times FROM activity_event ORDER BY id DESC LIMIT 1').get() as
        | { id: number; kind: string; times: number }
        | undefined;
      if (newest && newest.kind === event.kind) {
        const times = newest.times + 1;
        db.prepare(
          "UPDATE activity_event SET times = ?, summary = ?, at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        ).run(times, oneLine(scrubSecrets(say(times)), MAX_SUMMARY), newest.id);
      } else {
        logActivity(db, { ...event, summary: say(1) });
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error(`the activity log line "${event.kind}" could not be written: ${(err as Error).message}`);
  }
}

/**
 * Write one line to a database opened only now. For the sign-in route, which
 * touches no database otherwise: one that cannot be opened must never stop
 * him signing in, so that failure is only reported too. With `repeated`, a
 * line of the same kind in a row is counted instead (`logRepeatedActivity`).
 */
export function logActivityOpening(open: () => DatabaseSync, event: NewEvent, repeated?: (times: number) => string): void {
  try {
    const db = open();
    if (repeated) logRepeatedActivity(db, event, repeated);
    else logActivity(db, event);
  } catch (err) {
    console.error(`the activity log line "${event.kind}" could not be written: ${(err as Error).message}`);
  }
}

/** A name from Dane's data (a job's title, a portfolio project), secrets hidden first, then cut short and quoted. */
export function quotedName(name: string, env: Env = process.env): string {
  return `“${oneLine(scrubSecrets(name, env), MAX_TITLE)}”`;
}

/** A job's title, quoted and cut short, for a log line. */
export function jobName(db: DatabaseSync, opportunityId: number): string {
  const row = db.prepare('SELECT title FROM opportunity WHERE id = ?').get(opportunityId) as { title: string } | undefined;
  return row ? quotedName(row.title) : `job ${opportunityId}`;
}

/** The job a proposal is for, as `jobName` gives it, and its id. */
export function proposalJob(db: DatabaseSync, proposalId: number): { opportunityId: number | null; name: string } {
  const row = db.prepare('SELECT opportunity_id FROM proposal WHERE id = ?').get(proposalId) as
    | { opportunity_id: number }
    | undefined;
  if (!row) return { opportunityId: null, name: `proposal ${proposalId}` };
  return { opportunityId: row.opportunity_id, name: jobName(db, row.opportunity_id) };
}

/** Write a line about a proposal, naming its job. */
export function logProposalActivity(db: DatabaseSync, proposalId: number, actor: Actor, kind: string, say: (job: string) => string): void {
  try {
    const { opportunityId, name } = proposalJob(db, proposalId);
    logActivity(db, { actor, kind, summary: say(name), opportunityId, proposalId });
  } catch (err) {
    console.error(`the activity log line "${kind}" could not be written: ${(err as Error).message}`);
  }
}

/** Write a line about a job, naming it. */
export function logJobActivity(db: DatabaseSync, opportunityId: number, actor: Actor, kind: string, say: (job: string) => string): void {
  try {
    logActivity(db, { actor, kind, summary: say(jobName(db, opportunityId)), opportunityId });
  } catch (err) {
    console.error(`the activity log line "${kind}" could not be written: ${(err as Error).message}`);
  }
}

type Row = {
  id: number;
  at: string;
  actor: Actor;
  kind: string;
  summary: string;
  opportunity_id: number | null;
  proposal_id: number | null;
};

const toEvent = (r: Row): ActivityEvent => ({
  id: r.id,
  at: r.at,
  actor: r.actor,
  kind: r.kind,
  summary: r.summary,
  opportunityId: r.opportunity_id,
  proposalId: r.proposal_id,
});

/** The newest lines first, at most `limit` of them. */
export function listActivity(db: DatabaseSync, limit: number = DEFAULT_LIMIT): ActivityEvent[] {
  const rows = db
    .prepare('SELECT id, at, actor, kind, summary, opportunity_id, proposal_id FROM activity_event ORDER BY id DESC LIMIT ?')
    .all(limit) as Row[];
  return rows.map(toEvent);
}

/** How many lines there are in all. */
export function activityCount(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM activity_event').get() as { n: number }).n;
}

/** When, in Mountain time, the way the page shows it: "Nov 27, 2026, 9:32 AM MT". */
export function activityWhen(iso: string): string {
  return `${new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' })} MT`;
}

/** Where a line links to: the proposal when it has one, else the job, else nowhere. */
export function activityLink(e: Pick<ActivityEvent, 'opportunityId' | 'proposalId'>): string | null {
  if (e.proposalId !== null) return `/proposals/${e.proposalId}`;
  if (e.opportunityId !== null) return `/jobs#job-${e.opportunityId}`;
  return null;
}

/** The page's lines, already worded: when, who and what. */
export function activityLines(db: DatabaseSync, limit: number = DEFAULT_LIMIT) {
  return listActivity(db, limit).map((e) => ({
    id: e.id,
    when: activityWhen(e.at),
    who: ACTOR_LABELS[e.actor],
    what: e.summary,
    link: activityLink(e),
  }));
}
