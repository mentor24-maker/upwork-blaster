import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataDir, databasePath, migrationFiles, openDatabase, runMigrations } from '../lib/db.ts';
import { backupDatabase, copyName, KEEP_COPIES } from '../lib/backup.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = () => mkdtempSync(join(tmpdir(), 'ub-db-test-'));

const schema = (db) =>
  db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();

// ── where the file lives ──────────────────────────────────────────────────

test('the data folder defaults to ~/upwork-blaster-data, outside the repository', () => {
  assert.equal(dataDir({}), join(homedir(), 'upwork-blaster-data'));
  assert.equal(databasePath({ UB_DATA_DIR: '/tmp/ub' }), '/tmp/ub/app.sqlite');
  assert.equal(dataDir({ UB_DATA_DIR: '~/elsewhere' }), join(homedir(), 'elsewhere'));
});

test('a data folder inside the repository is refused', () => {
  for (const inside of [repo, join(repo, 'data'), join(repo, 'db', 'x'), `${repo}/./data/../data`]) {
    assert.throws(() => dataDir({ UB_DATA_DIR: inside }), /inside the repository/, inside);
  }
  assert.doesNotThrow(() => dataDir({ UB_DATA_DIR: `${repo}-data` }), 'a sibling folder with a similar name is fine');
});

test('.gitignore covers the data folder and any database file', () => {
  const dir = scratch();
  try {
    // Ask git itself, so the test checks the rules as git reads them.
    const ignored = (p) => {
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: repo });
        return true;
      } catch {
        return false;
      }
    };
    for (const p of ['data/app.sqlite', 'data/backups/app-2026-11-19T031500.sqlite', 'app.sqlite', 'app.sqlite-wal', 'app.sqlite-shm', 'lib/x.db']) {
      assert.ok(ignored(p), `${p} is ignored`);
    }
    assert.ok(!ignored('db/migrations/001_first_tables.sql'), 'the migrations themselves are not');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── migrations ────────────────────────────────────────────────────────────

test('the migrations build the three first tables on an empty database, and they read back', () => {
  const dir = scratch();
  try {
    const db = openDatabase(join(dir, 'app.sqlite'));
    assert.deepEqual(runMigrations(db), ['001_first_tables.sql', '002_opportunity_job_type_connects.sql', '003_ai_usage_and_extraction.sql', '004_evaluation.sql', '005_decision.sql']);

    db.prepare('INSERT INTO opportunity (url, title, description, budget) VALUES (?, ?, ?, ?)').run(
      'https://www.upwork.com/jobs/~test', 'A made-up job', 'Made-up text for the test.', null,
    );
    db.prepare('INSERT INTO preferences (settings) VALUES (?)').run(JSON.stringify({ weights: { fit: 30 } }));
    db.prepare('INSERT INTO portfolio_evidence (project, status, approved_for_use) VALUES (?, ?, ?)').run('Test project', 'delivered', 1);

    const job = db.prepare('SELECT url, title, budget, created_at FROM opportunity').get();
    assert.equal(job.url, 'https://www.upwork.com/jobs/~test');
    assert.equal(job.budget, null, 'a field the post did not state stays unknown');
    assert.match(job.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(JSON.parse(db.prepare('SELECT settings FROM preferences').get().settings), { weights: { fit: 30 } });
    assert.equal(db.prepare('SELECT version FROM preferences').get().version, 1);
    const ev = db.prepare('SELECT project, status, approved_for_use, links FROM portfolio_evidence').get();
    assert.deepEqual({ ...ev }, { project: 'Test project', status: 'delivered', approved_for_use: 1, links: '[]' });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tables refuse what they should', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const addJob = db.prepare('INSERT INTO opportunity (url, title, description) VALUES (?, ?, ?)');
  addJob.run('https://www.upwork.com/jobs/~same', 'One', 'x');
  assert.throws(() => addJob.run('https://www.upwork.com/jobs/~same', 'Two', 'y'), /UNIQUE/, 'a duplicate link');
  assert.throws(() => db.prepare('INSERT INTO preferences (settings) VALUES (?)').run('not json'), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO portfolio_evidence (project, status) VALUES ('p', 'maybe')").run(), /CHECK/);
  assert.equal(db.prepare('SELECT approved_for_use FROM portfolio_evidence').get(), undefined);
  db.prepare("INSERT INTO portfolio_evidence (project, status) VALUES ('p', 'planned')").run();
  assert.equal(db.prepare('SELECT approved_for_use FROM portfolio_evidence').get().approved_for_use, 0, 'not approved until Dane says so');
  db.close();
});

test('running the migrations twice changes nothing the second time', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'app.sqlite');
    let db = openDatabase(path);
    runMigrations(db);
    db.prepare("INSERT INTO opportunity (url, title, description) VALUES ('https://x/1', 't', 'd')").run();
    const before = { schema: schema(db), migrations: db.prepare('SELECT * FROM schema_migrations').all(), rows: db.prepare('SELECT * FROM opportunity').all() };
    db.close();

    db = openDatabase(path); // a fresh start, the way the app service does it
    assert.deepEqual(runMigrations(db), [], 'nothing ran');
    assert.deepEqual(schema(db), before.schema);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), before.migrations);
    assert.deepEqual(db.prepare('SELECT * FROM opportunity').all(), before.rows);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a migration that fails is rolled back whole and not recorded', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, '001_good.sql'), 'CREATE TABLE a (x INTEGER);');
    writeFileSync(join(dir, '002_bad.sql'), 'CREATE TABLE b (x INTEGER); INSERT INTO nowhere VALUES (1);');
    const db = openDatabase(':memory:');
    assert.throws(() => runMigrations(db, dir), /002_bad\.sql failed and was rolled back/);
    assert.deepEqual(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name), ['001_good.sql']);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get(), undefined, 'table b was rolled back');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration files are numbered and run in order', () => {
  const names = migrationFiles();
  assert.deepEqual(names, [...names].sort());
  assert.ok(names.every((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n)));
  const dir = scratch();
  try {
    writeFileSync(join(dir, '1-bad name.sql'), '');
    assert.throws(() => migrationFiles(dir), /is not named like/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the daily copy ────────────────────────────────────────────────────────

test('a copy holds the same data, and the last 14 are kept', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'app.sqlite');
    const backups = join(dir, 'backups');
    const db = openDatabase(path);
    runMigrations(db);
    db.prepare("INSERT INTO opportunity (url, title, description) VALUES ('https://x/1', 'kept', 'd')").run();
    // The app still has the file open while the copy is made, as on the Mini.

    const day = 24 * 60 * 60 * 1000;
    const start = Date.parse('2026-11-01T10:15:00Z');
    let last;
    for (let i = 0; i < KEEP_COPIES + 3; i++) last = backupDatabase(path, backups, { now: new Date(start + i * day) });
    db.close();

    const kept = readdirSync(backups).sort();
    assert.equal(kept.length, KEEP_COPIES);
    assert.equal(kept[0], copyName(new Date(start + 3 * day)), 'the three oldest went');
    assert.equal(last.path, join(backups, kept.at(-1)));
    assert.ok(last.bytes > 0);
    assert.equal(last.removed.length, 1);

    const copy = new DatabaseSync(last.path, { readOnly: true });
    assert.equal(copy.prepare('SELECT title FROM opportunity').get().title, 'kept');
    copy.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copies are named in Mountain time and sort by age', () => {
  assert.equal(copyName(new Date('2026-11-19T10:15:00Z')), 'app-2026-11-19T031500.sqlite', 'MST, UTC-7');
  assert.equal(copyName(new Date('2026-07-01T09:05:07Z')), 'app-2026-07-01T030507.sqlite', 'MDT, UTC-6');
});

test('with no database there is no copy, and nothing old is removed', () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, 'backups'));
    writeFileSync(join(dir, 'backups', 'app-2026-01-01T000000.sqlite'), 'old');
    assert.throws(() => backupDatabase(join(dir, 'app.sqlite'), join(dir, 'backups'), { keep: 0 }), /no database/);
    assert.deepEqual(readdirSync(join(dir, 'backups')), ['app-2026-01-01T000000.sqlite']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the command line migrates and copies, printing the copy and its size', () => {
  const dir = scratch();
  try {
    const env = { ...process.env, UB_DATA_DIR: dir };
    const run = (...args) => execFileSync(...args, { cwd: repo, env, encoding: 'utf8' });
    assert.match(run('node', ['--disable-warning=ExperimentalWarning', 'scripts/db.ts', 'migrate']), /ran 001_first_tables\.sql/);
    assert.match(run('node', ['--disable-warning=ExperimentalWarning', 'scripts/db.ts', 'migrate']), /already up to date/);
    const out = run('bash', ['scripts/run_db_backup.sh']);
    assert.match(out, new RegExp(`copied to ${dir}/backups/app-\\d{4}-\\d{2}-\\d{2}T\\d{6}\\.sqlite \\(\\d+ bytes\\)`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the launchd job that makes it daily ───────────────────────────────────

test('the daily-copy job runs once a day, beside the app service', () => {
  const config = JSON.parse(readFileSync(join(repo, 'spirality.project.json'), 'utf8'));
  const plist = execFileSync('bash', [join(repo, 'scripts/install_db_backup.sh'), '--print-plist'], { encoding: 'utf8' });
  assert.match(plist, new RegExp(`<key>Label</key>\\s*<string>${config.launchdPrefix}\\.db-backup</string>`));
  assert.match(plist, new RegExp(`<string>${repo}/scripts/run_db_backup.sh</string>`));
  assert.match(plist, /<key>StartCalendarInterval<\/key>\s*<dict>\s*<key>Hour<\/key>\s*<integer>3<\/integer>\s*<key>Minute<\/key>\s*<integer>15<\/integer>/);
  const log = join(config.logDir.replace(/^~/, homedir()), `${config.projectSlug}-db-backup.log`);
  assert.match(plist, new RegExp(`<key>StandardOutPath</key>\\s*<string>${log}</string>`));
  assert.doesNotMatch(plist, /@@\w+@@/);
});

test('the app service brings the database up to date before it starts', () => {
  const s = readFileSync(join(repo, 'scripts/run_app.sh'), 'utf8');
  assert.ok(s.indexOf('scripts/db.ts" migrate') > 0);
  assert.ok(s.indexOf('scripts/db.ts" migrate') < s.indexOf('exec doppler run'));
});
