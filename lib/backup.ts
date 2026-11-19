/**
 * The daily copy of the database (plan decision D4).
 *
 * `VACUUM INTO` writes a complete, consistent copy even while the app has the
 * file open, which a plain file copy of a WAL database does not promise. Each
 * copy is opened and checked (`PRAGMA integrity_check`) before it counts, and
 * only then are the oldest copies past the last 14 removed, so a bad copy
 * never pushes out a good one.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const KEEP_COPIES = 14;
const COPY_NAME = /^app-\d{4}-\d{2}-\d{2}T\d{6}\.sqlite$/;

export type BackupResult = { path: string; bytes: number; removed: string[] };

/** e.g. app-2026-11-19T093012.sqlite, in Mountain time, so the name sorts by age. */
export function copyName(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return `app-${parts.year}-${parts.month}-${parts.day}T${parts.hour}${parts.minute}${parts.second}.sqlite`;
}

export function backupDatabase(
  dbPath: string,
  backupsDir: string,
  { now = new Date(), keep = KEEP_COPIES }: { now?: Date; keep?: number } = {},
): BackupResult {
  if (!existsSync(dbPath)) throw new Error(`there is no database at ${dbPath} to copy`);
  mkdirSync(backupsDir, { recursive: true });
  const path = join(backupsDir, copyName(now));
  if (existsSync(path)) throw new Error(`a copy named ${path} already exists`);

  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    source.prepare('VACUUM INTO ?').run(path);
  } finally {
    source.close();
  }

  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    const row = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (row.integrity_check !== 'ok') throw new Error(`the copy ${path} failed its check: ${row.integrity_check}`);
  } finally {
    copy.close();
  }

  const copies = readdirSync(backupsDir).filter((n) => COPY_NAME.test(n)).sort();
  const removed = copies.slice(0, Math.max(0, copies.length - keep)).map((n) => join(backupsDir, n));
  for (const old of removed) rmSync(old);

  return { path, bytes: statSync(path).size, removed };
}
