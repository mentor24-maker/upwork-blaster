import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(repo, 'spirality.project.json'), 'utf8'));
const plist = execFileSync('bash', [join(repo, 'scripts/install_app_service.sh'), '--print-plist'], {
  encoding: 'utf8',
});

// The value after <key>name</key>, whatever element holds it.
const valueOf = (name) => {
  const m = plist.match(new RegExp(`<key>${name}</key>\\s*<(\\w+)\\s*/?>([^<]*)`));
  assert.ok(m, `the plist has no ${name}`);
  return m[1] === 'string' || m[1] === 'integer' ? m[2] : m[1];
};

test('the service is labelled beside the loop jobs and serves this checkout', () => {
  assert.equal(valueOf('Label'), `${config.launchdPrefix}.app`);
  assert.equal(valueOf('WorkingDirectory'), repo);
  assert.match(plist, new RegExp(`<string>${repo}/scripts/run_app.sh</string>`));
  assert.doesNotMatch(plist, /@@\w+@@/, 'every placeholder is filled in');
});

test('it runs on port 4280 and comes back after a crash or a reboot', () => {
  assert.equal(valueOf('APP_PORT'), '4280');
  assert.equal(valueOf('RunAtLoad'), 'true');
  assert.equal(valueOf('KeepAlive'), 'true');
});

test("its log goes in the project's log folder", () => {
  const logDir = config.logDir.replace(/^~/, homedir());
  const log = join(logDir, `${config.projectSlug}-app.log`);
  assert.equal(valueOf('StandardOutPath'), log);
  assert.equal(valueOf('StandardErrorPath'), log);
});

test('verify runs the type check before the tests', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.verify, /^npm run typecheck && node --test$/);
  assert.match(pkg.scripts.typecheck, /tsc --noEmit/);
});
