import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '../lib/db.ts';
import {
  currentPreferences,
  DEFAULT_WEIGHTS,
  listPreferenceVersions,
  preferencesFormMessage,
  preferencesVersion,
  readList,
  readPreferencesForm,
  savePreferences,
} from '../lib/preferences.ts';
import { gate } from '../lib/gate.ts';
import { POST as postPreferences } from '../app/api/preferences/route.ts';

// Made-up preferences for the tests only.
const fields = (over = {}) => ({
  themes: 'Dashboards\nWorkflow automation',
  requiredTech: 'Next.js\nTypeScript',
  unsupportedTech: 'WordPress',
  exclusions: 'The post forbids AI tools',
  weight_fit: '30',
  weight_budget: '25',
  weight_clarity: '20',
  weight_client: '15',
  weight_interest: '10',
  ...over,
});
const asForm = (obj) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
};
const freshDb = () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
};

test('the starting weights are the hand-off’s 30/25/20/15/10', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, { fit: 30, budget: 25, clarity: 20, client: 15, interest: 10 });
});

test('preferences saved twice read back as two versions, the newest in force', () => {
  const db = freshDb();
  assert.equal(currentPreferences(db), undefined, 'nothing before the first save');

  const first = readPreferencesForm(asForm(fields()));
  assert.ok(first.ok);
  const v1 = savePreferences(db, first.settings);

  const second = readPreferencesForm(
    asForm(fields({ themes: 'SaaS MVPs', weight_fit: '40', weight_budget: '15', exclusions: '' })),
  );
  assert.ok(second.ok);
  const v2 = savePreferences(db, second.settings);
  assert.ok(v2 > v1, 'a new version number');

  assert.deepEqual(preferencesVersion(db, v1).settings, {
    themes: ['Dashboards', 'Workflow automation'],
    requiredTech: ['Next.js', 'TypeScript'],
    unsupportedTech: ['WordPress'],
    exclusions: ['The post forbids AI tools'],
    weights: { fit: 30, budget: 25, clarity: 20, client: 15, interest: 10 },
  });
  assert.deepEqual(preferencesVersion(db, v2).settings, {
    themes: ['SaaS MVPs'],
    requiredTech: ['Next.js', 'TypeScript'],
    unsupportedTech: ['WordPress'],
    exclusions: [],
    weights: { fit: 40, budget: 15, clarity: 20, client: 15, interest: 10 },
  });
  assert.equal(currentPreferences(db).version, v2);
  assert.deepEqual(listPreferenceVersions(db).map((v) => v.version), [v2, v1], 'newest first');
  assert.equal(preferencesVersion(db, 999), undefined);
  db.close();
});

test('weights that do not add up to 100 are refused with a plain message', () => {
  for (const [over, total] of [
    [{ weight_fit: '35' }, 105],
    [{ weight_interest: '0' }, 90],
    [{ weight_fit: '0', weight_budget: '0', weight_clarity: '0', weight_client: '0', weight_interest: '0' }, 0],
  ]) {
    assert.deepEqual(readPreferencesForm(asForm(fields(over))), { ok: false, error: 'weights-total', total });
  }
  assert.equal(
    preferencesFormMessage('weights-total', '105'),
    'The five weights add up to 105; they must add up to 100. Nothing was saved.',
  );
  assert.equal(
    preferencesFormMessage('weights-total', '<b>'),
    'The five weights must add up to 100. Nothing was saved.',
    'a total from the address is only shown when it is a plain number',
  );
});

test('the form refuses what it should, each with a plain message', () => {
  const cases = [
    [{ weight_fit: '' }, 'bad-weight'],
    [{ weight_fit: '-5' }, 'bad-weight'],
    [{ weight_fit: '2.5' }, 'bad-weight'],
    [{ weight_fit: '101' }, 'bad-weight'],
    [{ weight_fit: 'thirty' }, 'bad-weight'],
    [{ themes: Array.from({ length: 101 }, (_, i) => `Theme ${i}`).join('\n') }, 'too-many'],
    [{ exclusions: 'x'.repeat(201) }, 'too-long'],
  ];
  for (const [over, error] of cases) {
    assert.deepEqual(readPreferencesForm(asForm(fields(over))), { ok: false, error }, JSON.stringify(over).slice(0, 60));
    assert.ok(preferencesFormMessage(error), `${error} has a message`);
  }
  assert.equal(preferencesFormMessage('<script>'), null, 'only its own messages, whatever the address says');
  assert.equal(preferencesFormMessage(undefined), null);
});

test('a list is one entry per line, tidied, with repeats kept once', () => {
  assert.deepEqual(readList('  Dashboards \r\n\n dashboards\nSaaS   MVPs\n'), ['Dashboards', 'SaaS MVPs']);
  assert.deepEqual(readList(''), []);
});

test('the form post saves a new version each time, and refuses a bad total', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-prefs-test-'));
  const saved = process.env.UB_DATA_DIR;
  process.env.UB_DATA_DIR = dir;
  try {
    const setup = openDatabase(join(dir, 'app.sqlite'));
    runMigrations(setup); // what scripts/run_app.sh does before the app starts
    setup.close();
    const post = (obj) =>
      postPreferences(new Request('http://mac-mini.local:4280/api/preferences', { method: 'POST', body: asForm(obj) }));

    const first = await post(fields());
    assert.equal(first.status, 303);
    const v1 = Number(/^\/preferences\?saved=(\d+)$/.exec(first.headers.get('location'))?.[1]);
    assert.ok(v1 > 0);

    const second = await post(fields({ weight_fit: '20', weight_clarity: '30' }));
    assert.equal(second.headers.get('location'), `/preferences?saved=${v1 + 1}`);

    const bad = await post(fields({ weight_fit: '50' }));
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get('location'), '/preferences?error=weights-total&total=120');

    // Both saves are on disk, the refused one is not.
    const db = openDatabase(join(dir, 'app.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM preferences').get().n, 2);
    assert.equal(currentPreferences(db).settings.weights.clarity, 30);
    db.close();
  } finally {
    if (saved === undefined) delete process.env.UB_DATA_DIR;
    else process.env.UB_DATA_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Preferences page and its form post are behind the password', () => {
  const ENV = { APP_PASSWORD: 'test-only-password', APP_SESSION_SECRET: 'test-only-session-secret' };
  for (const path of ['/preferences', '/preferences?saved=1']) {
    const res = gate(new Request(`http://mac-mini.local:4280${path}`), ENV);
    assert.equal(res?.status, 307, path);
    assert.equal(res.headers.get('location'), 'http://mac-mini.local:4280/sign-in');
  }
  const post = gate(new Request('http://mac-mini.local:4280/api/preferences', { method: 'POST', body: asForm(fields()) }), ENV);
  assert.equal(post?.status, 401, 'a signed-out form post gets nothing');
});
