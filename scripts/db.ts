/**
 * The database from the command line.
 *
 *   npm run db:migrate   run any migration not yet run; prints what it ran
 *   npm run db:backup    make today's copy, check it, keep the last 14;
 *                        prints the copy and its size
 *
 * Both use the data folder lib/db.ts names (UB_DATA_DIR, or
 * ~/upwork-blaster-data). The daily copy is run by the launchd job
 * scripts/install_db_backup.sh installs.
 */

import { join } from 'node:path';
import { databasePath, dataDir, openDatabase, runMigrations } from '../lib/db.ts';
import { backupDatabase } from '../lib/backup.ts';

const stamp = () => new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour12: false });

const command = process.argv[2];
try {
  if (command === 'migrate') {
    const db = openDatabase(databasePath());
    try {
      const ran = runMigrations(db);
      console.log(`[db] ${stamp()} ${databasePath()}: ${ran.length ? `ran ${ran.join(', ')}` : 'already up to date'}`);
    } finally {
      db.close();
    }
  } else if (command === 'backup') {
    const { path, bytes, removed } = backupDatabase(databasePath(), join(dataDir(), 'backups'));
    console.log(`[db] ${stamp()} copied to ${path} (${bytes} bytes)`);
    for (const r of removed) console.log(`[db] ${stamp()} removed old copy ${r}`);
  } else {
    console.error('usage: node scripts/db.ts migrate|backup');
    process.exit(2);
  }
} catch (err) {
  console.error(`[db] ${stamp()} FAILED: ${(err as Error).message}`);
  process.exit(1);
}
