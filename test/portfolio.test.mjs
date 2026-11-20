import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '../lib/db.ts';
import {
  addEntry,
  approvedEvidence,
  getEntry,
  listEntries,
  portfolioFormMessage,
  readPortfolioForm,
  removeEntry,
  updateEntry,
} from '../lib/portfolio.ts';
import { gate } from '../lib/gate.ts';
import { POST as postPortfolio } from '../app/api/portfolio/route.ts';

// Made-up entries for the tests only: no real portfolio data (plan D7).
const fields = (over = {}) => ({
  project: 'Example Dashboard',
  status: 'delivered',
  features: 'A made-up dashboard\nwith two charts',
  links: 'https://example.com/demo\n\nhttps://example.com/demo\nhttps://example.org/case-study',
  approvedForUse: '1',
  ...over,
});
const asForm = (obj) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f.set(k, v);
  return f;
};
const freshDb = () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
};
const read = (over) => {
  const r = readPortfolioForm(asForm(fields(over)));
  assert.ok(r.ok, JSON.stringify(r));
  return r.entry;
};

test('an entry is added, edited and removed, and only approved entries reach drafting', () => {
  const db = freshDb();
  assert.deepEqual(approvedEvidence(db), []);

  const approvedId = addEntry(db, read());
  const plannedId = addEntry(db, read({ project: 'Example Planned Tool', status: 'planned', approvedForUse: undefined, links: '' }));

  assert.deepEqual(getEntry(db, approvedId), {
    ...getEntry(db, approvedId),
    project: 'Example Dashboard',
    status: 'delivered',
    features: 'A made-up dashboard\nwith two charts',
    links: ['https://example.com/demo', 'https://example.org/case-study'],
    approvedForUse: true,
  });
  const planned = getEntry(db, plannedId);
  assert.equal(planned.status, 'planned');
  assert.equal(planned.approvedForUse, false);
  assert.deepEqual(listEntries(db).map((e) => e.id), [approvedId, plannedId], 'the page shows both');
  assert.deepEqual(approvedEvidence(db).map((e) => e.id), [approvedId], 'drafting sees only the approved one');

  // Edit: approve the planned one, take approval away from the other.
  assert.equal(updateEntry(db, plannedId, read({ project: 'Example Planned Tool v2', status: 'in progress' })), true);
  assert.equal(updateEntry(db, approvedId, read({ approvedForUse: undefined })), true);
  assert.equal(getEntry(db, plannedId).project, 'Example Planned Tool v2');
  assert.equal(getEntry(db, plannedId).status, 'in progress');
  assert.deepEqual(approvedEvidence(db).map((e) => e.id), [plannedId], 'approval follows the edit');

  // Remove.
  assert.equal(removeEntry(db, plannedId), true);
  assert.equal(getEntry(db, plannedId), undefined);
  assert.deepEqual(approvedEvidence(db), []);
  assert.deepEqual(listEntries(db).map((e) => e.id), [approvedId]);

  // An id that is not there changes nothing.
  assert.equal(updateEntry(db, 999, read()), false);
  assert.equal(removeEntry(db, 999), false);
  db.close();
});

test('the form refuses what it should, each with a plain message', () => {
  const cases = [
    [{ project: '   ' }, 'no-project'],
    [{ project: 'x'.repeat(201) }, 'too-long'],
    [{ status: 'shipped' }, 'bad-status'],
    [{ status: undefined }, 'bad-status'],
    [{ links: 'not a link' }, 'bad-link'],
    [{ links: 'javascript:alert(1)' }, 'bad-link'],
    [{ links: 'ftp://example.com/file' }, 'bad-link'],
    [{ links: Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`).join('\n') }, 'too-many-links'],
    [{ features: 'x'.repeat(5001) }, 'too-long'],
  ];
  for (const [over, error] of cases) {
    assert.deepEqual(readPortfolioForm(asForm(fields(over))), { ok: false, error }, JSON.stringify(over).slice(0, 60));
    assert.ok(portfolioFormMessage(error), `${error} has a message`);
  }
  assert.equal(portfolioFormMessage('<script>'), null, 'only its own messages, whatever the address says');
  assert.equal(portfolioFormMessage(undefined), null);
});

test('the form tidies what it keeps', () => {
  const entry = read({ project: '  Example   Site ', features: '  line one\r\nline two  ', approvedForUse: undefined });
  assert.equal(entry.project, 'Example Site');
  assert.equal(entry.features, 'line one\nline two');
  assert.equal(entry.approvedForUse, false, 'an unticked box sends nothing');
  assert.deepEqual(entry.links, ['https://example.com/demo', 'https://example.org/case-study'], 'blanks and repeats dropped');
});

test('the form posts add, edit and remove, and refuse a bad entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-portfolio-test-'));
  const savedEnv = process.env.UB_DATA_DIR;
  process.env.UB_DATA_DIR = dir;
  try {
    const setup = openDatabase(join(dir, 'app.sqlite'));
    runMigrations(setup); // what scripts/run_app.sh does before the app starts
    setup.close();
    const post = (obj) =>
      postPortfolio(new Request('http://mac-mini.local:4280/api/portfolio', { method: 'POST', body: asForm(obj) }));

    const added = await post({ action: 'add', ...fields({ status: 'planned', approvedForUse: undefined }) });
    assert.equal(added.status, 303);
    const id = Number(/^\/portfolio\?saved=(\d+)$/.exec(added.headers.get('location'))?.[1]);
    assert.ok(id > 0);

    const edited = await post({ action: 'update', id: String(id), ...fields({ project: 'Example Renamed' }) });
    assert.equal(edited.headers.get('location'), `/portfolio?saved=${id}`);

    const badEdit = await post({ action: 'update', id: String(id), ...fields({ status: 'nope' }) });
    assert.equal(badEdit.headers.get('location'), `/portfolio?error=bad-status&id=${id}`);

    const badAdd = await post({ action: 'add', ...fields({ project: '' }) });
    assert.equal(badAdd.headers.get('location'), '/portfolio?error=no-project');

    let db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM portfolio_evidence').get().n, 1, 'the refused add saved nothing');
    assert.equal(getEntry(db, id).project, 'Example Renamed');
    assert.equal(getEntry(db, id).approvedForUse, true);
    assert.equal(getEntry(db, id).status, 'delivered', 'the refused edit changed nothing');
    db.close();

    const removed = await post({ action: 'remove', id: String(id), confirm: 'on' });
    assert.equal(removed.headers.get('location'), '/portfolio?removed=1');
    const again = await post({ action: 'remove', id: String(id), confirm: 'on' });
    assert.equal(again.headers.get('location'), '/portfolio?error=not-found');
    const noId = await post({ action: 'update', ...fields() });
    assert.equal(noId.headers.get('location'), '/portfolio?error=not-found');

    db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM portfolio_evidence').get().n, 0);
    db.close();
  } finally {
    if (savedEnv === undefined) delete process.env.UB_DATA_DIR;
    else process.env.UB_DATA_DIR = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Portfolio page and its form post are behind the password', () => {
  const ENV = { APP_PASSWORD: 'test-only-password', APP_SESSION_SECRET: 'test-only-session-secret' };
  for (const path of ['/portfolio', '/portfolio?saved=1']) {
    const res = gate(new Request(`http://mac-mini.local:4280${path}`), ENV);
    assert.equal(res?.status, 307, path);
    assert.equal(res.headers.get('location'), 'http://mac-mini.local:4280/sign-in');
  }
  const post = gate(
    new Request('http://mac-mini.local:4280/api/portfolio', { method: 'POST', body: asForm({ action: 'add', ...fields() }) }),
    ENV,
  );
  assert.equal(post?.status, 401, 'a signed-out form post gets nothing');
});
