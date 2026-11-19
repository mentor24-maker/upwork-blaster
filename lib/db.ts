/**
 * The app's database (plan decision D4): one SQLite file on the Mini, through
 * Node's built-in `node:sqlite`, with migrations kept in the repository.
 *
 * The file lives in a data folder OUTSIDE the repository, because this
 * repository is public and the file holds Dane's data:
 *
 *   UB_DATA_DIR   the data folder; defaults to ~/upwork-blaster-data
 *     app.sqlite      the database
 *     backups/        the daily copies (lib/backup.ts), the last 14 kept
 *
 * `dataDir()` refuses a folder inside the repository, so a wrong setting fails
 * loudly instead of putting the file where `git add` could pick it up.
 *
 * Migrations are the numbered `.sql` files in db/migrations, run in name
 * order. Each one runs once, inside a transaction, and is recorded in the
 * `schema_migrations` table; running them again changes nothing.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_DIR = join(REPO_DIR, 'db', 'migrations');
export const DB_FILE_NAME = 'app.sqlite';

type Env = Record<string, string | undefined>;

/** The nearest folder that exists, resolved through any symlinks. */
function realExisting(path: string): string {
  let p = path;
  while (!existsSync(p)) {
    const up = dirname(p);
    if (up === p) return p;
    p = up;
  }
  return join(realpathSync(p), relative(p, path));
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(realExisting(parent), realExisting(child));
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

/** The data folder: UB_DATA_DIR, or ~/upwork-blaster-data. Never inside the repository. */
export function dataDir(env: Env = process.env, repoDir: string = REPO_DIR): string {
  const raw = env.UB_DATA_DIR?.trim() || join(homedir(), 'upwork-blaster-data');
  const dir = resolve(raw.replace(/^~(?=\/|$)/, homedir()));
  if (isInside(dir, repoDir)) {
    throw new Error(`the data folder ${dir} is inside the repository ${repoDir}; it must live outside it (set UB_DATA_DIR)`);
  }
  return dir;
}

/** Where the database file is. */
export function databasePath(env: Env = process.env): string {
  return join(dataDir(env), DB_FILE_NAME);
}

/** Open (creating if need be) the database file, with foreign keys on. */
export function openDatabase(path: string = databasePath()): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/** The migration files, in the order they run. */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  // The hint keeps Next.js from packing the whole project because of this read.
  const names = readdirSync(/*turbopackIgnore: true*/ dir).filter((n) => n.endsWith('.sql')).sort();
  for (const n of names) {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(n)) throw new Error(`migration ${n} is not named like 001_some_name.sql`);
  }
  return names;
}

/**
 * Run every migration not yet recorded. Returns the names it ran, which is
 * empty when the database is already up to date.
 */
export function runMigrations(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const done = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const ran: string[] = [];
  for (const name of migrationFiles(dir)) {
    if (done.has(name)) continue;
    const sql = readFileSync(/*turbopackIgnore: true*/ join(dir, name), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${name} failed and was rolled back: ${(err as Error).message}`);
    }
    ran.push(name);
  }
  return ran;
}
