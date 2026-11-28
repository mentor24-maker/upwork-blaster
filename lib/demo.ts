/**
 * The made-up data Demo mode shows (UB-30), so Dane can click through the
 * whole app without touching real jobs.
 *
 * It is the same made-up jobs and portfolio the end-to-end test uses
 * (test/e2e/fixtures). Each job is saved with the fields its `aiAnswer`
 * holds, checked the same way a real AI answer is (lib/extractJob.ts), so
 * no request goes to the Claude API and no key is used. Then it is scored
 * with the usual rules (lib/score.ts).
 *
 * The preferences are the ones the end-to-end test saves (Next.js and
 * TypeScript wanted, WordPress not taken, casino jobs excluded), so the
 * Inbox shows a ranked job, a job he does not take and an excluded one.
 *
 * Every function here takes the demo database only, and throws when handed
 * any other file: made-up records must never reach the real one.
 */

import { realpathSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import jobsFixture from '../test/e2e/fixtures/jobs.json' with { type: 'json' };
import portfolioFixture from '../test/e2e/fixtures/portfolio.json' with { type: 'json' };
import { logActivity } from './activity.ts';
import { demoDatabasePath } from './db.ts';
import { checkAnswer, quotePost } from './extractJob.ts';
import { findJobByUrl, saveJob } from './jobs.ts';
import { addEntry, listEntries, type EvidenceStatus } from './portfolio.ts';
import { currentPreferences, DEFAULT_WEIGHTS, savePreferences, type Settings } from './preferences.ts';
import { scoreJobAndRecord } from './score.ts';

type Env = Record<string, string | undefined>;

type FixtureJob = { key: string; url: string; title: string; description: string; aiAnswer: unknown };
type FixtureEntry = { project: string; status: string; features: string; links: string; approvedForUse: boolean };

export const DEMO_JOBS: readonly FixtureJob[] = (jobsFixture as { jobs: FixtureJob[] }).jobs;
export const DEMO_PORTFOLIO: readonly FixtureEntry[] = (portfolioFixture as { entries: FixtureEntry[] }).entries;

/** The preferences the end-to-end test saves; Demo mode starts from them. */
export const DEMO_PREFERENCES: Settings = {
  themes: ['Dashboards'],
  requiredTech: ['Next.js', 'TypeScript'],
  unsupportedTech: ['WordPress'],
  exclusions: ['casino'],
  weights: DEFAULT_WEIGHTS,
};


function fileOf(db: DatabaseSync): string {
  const row = db.prepare('PRAGMA database_list').get() as { file?: string } | undefined;
  return row?.file ?? '';
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Throws unless `db` is the demo database file. */
export function assertDemoDatabase(db: DatabaseSync, env: Env = process.env): void {
  const file = fileOf(db);
  if (!file || real(file) !== real(demoDatabasePath(env))) {
    throw new Error(`refusing to write demo data to ${file || 'a database with no file'}: only ${demoDatabasePath(env)} takes it`);
  }
}

export type DemoLoad = { jobsAdded: number; entriesAdded: number; preferencesSaved: boolean };

/**
 * Put the made-up jobs, portfolio and preferences into the demo database.
 * Running it again adds nothing: jobs are matched by link, portfolio entries
 * by project name, and preferences are saved only when there are none.
 */
export function loadDemoData(db: DatabaseSync, env: Env = process.env): DemoLoad {
  assertDemoDatabase(db, env);
  const result: DemoLoad = { jobsAdded: 0, entriesAdded: 0, preferencesSaved: false };

  // Preferences and portfolio first, so the jobs are scored against them.
  if (!currentPreferences(db)) {
    savePreferences(db, DEMO_PREFERENCES);
    result.preferencesSaved = true;
  }

  const have = new Set(listEntries(db).map((e) => e.project));
  for (const e of DEMO_PORTFOLIO) {
    if (have.has(e.project)) continue;
    addEntry(db, {
      project: e.project,
      status: e.status as EvidenceStatus,
      features: e.features,
      links: e.links ? [e.links] : [],
      approvedForUse: e.approvedForUse,
    });
    have.add(e.project);
    result.entriesAdded += 1;
  }

  for (const j of DEMO_JOBS) {
    if (findJobByUrl(db, j.url)) continue;
    // The fixture's answer, checked as a real AI answer would be: no API call.
    const f = checkAnswer(j.aiAnswer, quotePost(j.title, j.description));
    const saved = saveJob(db, {
      url: j.url,
      title: j.title,
      description: j.description,
      budget: f.budget,
      jobType: f.jobType,
      postedAt: f.postedAt,
      client: f.client,
      connectsCost: f.connectsCost,
    });
    if (!saved.ok) continue;
    db.prepare(`UPDATE opportunity SET extracted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(saved.id);
    const problem = scoreJobAndRecord(db, saved.id);
    if (problem) throw new Error(`the demo job "${j.title}" could not be scored: ${problem}`);
    result.jobsAdded += 1;
  }

  if (result.jobsAdded || result.entriesAdded || result.preferencesSaved) {
    logActivity(db, {
      actor: 'app',
      kind: 'demo-loaded',
      summary: `The app loaded the made-up demo data (${result.jobsAdded} job${result.jobsAdded === 1 ? '' : 's'}, ${result.entriesAdded} portfolio entr${result.entriesAdded === 1 ? 'y' : 'ies'}).`,
    });
  }
  return result;
}

/**
 * Empty the demo database, every table but the migrations record, so a
 * fresh run-through starts clean. Some tables refuse deletes by design
 * (a saved proposal version is never deleted), so the triggers are set aside
 * and put back exactly as they were, all in one transaction.
 */
export function emptyDemoDatabase(db: DatabaseSync, env: Env = process.env): void {
  assertDemoDatabase(db, env);
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`).all() as { name: string }[]).map((r) => r.name);
  const triggers = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`).all() as { name: string; sql: string }[];
  const hasSequence = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'`).get();
  const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of triggers) db.exec(`DROP TRIGGER ${q(t.name)}`);
      for (const name of tables) db.exec(`DELETE FROM ${q(name)}`);
      if (hasSequence) db.exec('DELETE FROM sqlite_sequence');
      for (const t of triggers) db.exec(t.sql);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/** The "Reload demo data" button: empty the demo database and load it again. */
export function reloadDemoData(db: DatabaseSync, env: Env = process.env): DemoLoad {
  emptyDemoDatabase(db, env);
  return loadDemoData(db, env);
}

/** What the Jobs page says after a demo load, from the address (`?demo=`). */
export function demoMessage(code: string | string[] | undefined): string | null {
  const c = Array.isArray(code) ? code[0] : code;
  if (c === 'loaded') return 'The made-up demo data is loaded.';
  if (c === 'failed') return 'The made-up demo data could not be loaded. The app’s log says why; nothing real was touched.';
  return null;
}

/** Load (or reload) into the database in force, for a route: the `?demo=` code to show. */
export function runDemoLoad(open: () => DatabaseSync, fresh: boolean): 'loaded' | 'failed' {
  try {
    const db = open();
    if (fresh) reloadDemoData(db);
    else loadDemoData(db);
    return 'loaded';
  } catch (err) {
    console.error(`the demo data could not be loaded: ${(err as Error).message}`);
    return 'failed';
  }
}
