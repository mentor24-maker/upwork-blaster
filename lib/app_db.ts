/**
 * The one open database the running app shares (lib/db.ts names the file).
 * Opened on first use and kept open.
 *
 * Which file depends on the mode (lib/mode.ts): demo.sqlite while Demo is on,
 * app.sqlite otherwise. The mode is read on every call, so a switch takes
 * effect on the very next page or form, and no page needs a change of its own.
 *
 * The app does not run the migrations itself: the app service runs them
 * before it starts (scripts/run_app.sh) and so does `npm run dev`. Reading
 * the migrations folder from inside the app would make Next.js pack the
 * whole project into its build.
 */

import type { DatabaseSync } from 'node:sqlite';
import { databasePath, demoDatabasePath, openDatabase } from './db.ts';
import { currentMode } from './mode.ts';

type Env = Record<string, string | undefined>;

const open = new Map<string, DatabaseSync>();

export function appDatabase(env: Env = process.env): DatabaseSync {
  const path = currentMode(env) === 'demo' ? demoDatabasePath(env) : databasePath(env);
  let db = open.get(path);
  if (!db) {
    db = openDatabase(path);
    open.set(path, db);
  }
  return db;
}
