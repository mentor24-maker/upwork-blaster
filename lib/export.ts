/**
 * Everything Dane has put into Upwork Blaster, as one JSON file (plan task
 * 4.6, "Dane can export all his own data").
 *
 * It reads the database and nothing else: never the environment, so no
 * password, cookie key or AI key can reach the file. Each list below is every
 * row of one table, oldest first, under its own name. A column the database
 * already keeps as JSON text (it has a `json_valid` check) comes out as JSON,
 * not as a string inside a string.
 *
 * Left out on purpose: the AI spending log (`ai_usage`) and the migration
 * bookkeeping (`schema_migrations`). They are about the app, not his work.
 * The daily database copy (lib/backup.ts) stays the real backup; this file
 * is for reading his data anywhere else.
 */

import type { DatabaseSync } from 'node:sqlite';

/** The file's lists, in the order they appear: name in the file → table. */
export const EXPORT_LISTS = [
  ['jobs', 'opportunity'],
  ['decisions', 'decision'],
  ['evaluations', 'evaluation'],
  ['preferences', 'preferences'],
  ['portfolioEvidence', 'portfolio_evidence'],
  ['proposals', 'proposal'],
  ['proposalQuestions', 'proposal_question'],
  ['approvals', 'approval'],
  ['sentRecords', 'sent_record'],
  ['pipelineMoves', 'pipeline_move'],
  ['pipelineNotes', 'pipeline_note'],
  ['pipelineNextActions', 'pipeline_next_action'],
] as const;

export type ExportListName = (typeof EXPORT_LISTS)[number][0];
type Row = Record<string, unknown>;

export type DataExport = {
  about: {
    app: 'Upwork Blaster';
    /** When the file was made, Mountain time, e.g. 2026-11-27T10:52:03-07:00. */
    exportedAt: string;
    /** The newest database migration run, so a reader knows what shape to expect. */
    databaseVersion: number;
    databaseMigration: string;
  };
} & Record<ExportListName, Row[]>;

function mountainParts(now: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
}

/** e.g. 2026-11-27T10:52:03-07:00, the moment in Mountain time with its offset. */
export function mountainTimestamp(now: Date = new Date()): string {
  const p = mountainParts(now);
  const offset = p.timeZoneName.replace(/^GMT/, '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

/** e.g. upwork-blaster-export-2026-11-27.json, dated in Mountain time. */
export function exportFileName(now: Date = new Date()): string {
  const p = mountainParts(now);
  return `upwork-blaster-export-${p.year}-${p.month}-${p.day}.json`;
}

/** The columns of a table the database itself checks with json_valid(...). */
function jsonColumns(db: DatabaseSync, table: string): Set<string> {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | { sql: string }
    | undefined;
  if (!row) throw new Error(`the database has no ${table} table; run the migrations first`);
  return new Set([...row.sql.matchAll(/json_valid\s*\(\s*"?(\w+)"?\s*\)/gi)].map((m) => m[1]));
}

function readTable(db: DatabaseSync, table: string): Row[] {
  const json = jsonColumns(db, table);
  // The table names come from EXPORT_LISTS above, never from a request.
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[];
  if (json.size === 0) return rows;
  return rows.map((row) => {
    const out: Row = { ...row };
    for (const col of json) {
      if (typeof out[col] === 'string') out[col] = JSON.parse(out[col] as string);
    }
    return out;
  });
}

/** Every row of every list, plus when and from which database version. */
export function buildExport(db: DatabaseSync, now: Date = new Date()): DataExport {
  const newest = db.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get() as
    | { name: string }
    | undefined;
  if (!newest) throw new Error('the database has no migrations recorded; run them first');
  // One read transaction, so every list is from the same moment.
  db.exec('BEGIN');
  try {
    const lists = Object.fromEntries(EXPORT_LISTS.map(([name, table]) => [name, readTable(db, table)])) as Record<
      ExportListName,
      Row[]
    >;
    return {
      about: {
        app: 'Upwork Blaster',
        exportedAt: mountainTimestamp(now),
        databaseVersion: Number.parseInt(newest.name, 10),
        databaseMigration: newest.name,
      },
      ...lists,
    };
  } finally {
    db.exec('COMMIT');
  }
}

/** The file's text: the export as indented JSON. */
export function exportText(db: DatabaseSync, now: Date = new Date()): string {
  return JSON.stringify(buildExport(db, now), null, 2) + '\n';
}
