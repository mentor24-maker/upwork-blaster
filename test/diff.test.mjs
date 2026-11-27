// The line-by-line comparison behind the version history's side-by-side view (UB-29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasChanges, lineDiff, MAX_DIFF_CELLS } from '../lib/diff.ts';

const same = (text) => ({ text, kind: 'same' });
const removed = (text) => ({ text, kind: 'removed' });
const added = (text) => ({ text, kind: 'added' });

test('identical text: every line lines up, unchanged', () => {
  const rows = lineDiff('one\ntwo\nthree', 'one\ntwo\nthree');
  assert.deepEqual(rows, [
    { left: same('one'), right: same('one') },
    { left: same('two'), right: same('two') },
    { left: same('three'), right: same('three') },
  ]);
  assert.equal(hasChanges(rows), false);
});

test('an added line is marked added on the right, with nothing opposite it', () => {
  const rows = lineDiff('one\nthree', 'one\ntwo\nthree');
  assert.deepEqual(rows, [
    { left: same('one'), right: same('one') },
    { left: null, right: added('two') },
    { left: same('three'), right: same('three') },
  ]);
  assert.equal(hasChanges(rows), true);
});

test('a removed line is marked removed on the left, with nothing opposite it', () => {
  assert.deepEqual(lineDiff('one\ntwo\nthree', 'one\nthree'), [
    { left: same('one'), right: same('one') },
    { left: removed('two'), right: null },
    { left: same('three'), right: same('three') },
  ]);
});

test('a changed line: the old wording removed on the left, the new added on the right, on one row', () => {
  assert.deepEqual(lineDiff('Hello,\nI start Monday.\nThanks', 'Hello,\nI start Tuesday.\nThanks'), [
    { left: same('Hello,'), right: same('Hello,') },
    { left: removed('I start Monday.'), right: added('I start Tuesday.') },
    { left: same('Thanks'), right: same('Thanks') },
  ]);
});

test('empty text: nothing against nothing is no rows; empty against text is all added, and the reverse all removed', () => {
  assert.deepEqual(lineDiff('', ''), []);
  assert.deepEqual(lineDiff('', 'a\nb'), [
    { left: null, right: added('a') },
    { left: null, right: added('b') },
  ]);
  assert.deepEqual(lineDiff('a\nb', ''), [
    { left: removed('a'), right: null },
    { left: removed('b'), right: null },
  ]);
});

test('unchanged lines stay lined up around several changes, and blank lines count as lines', () => {
  const before = 'A\n\nB\nC\nD';
  const after = 'A\n\nB2\nC\nE\nD';
  const rows = lineDiff(before, after);
  const sameRows = rows.filter((r) => r.left?.kind === 'same');
  assert.deepEqual(
    sameRows.map((r) => [r.left.text, r.right.text]),
    [['A', 'A'], ['', ''], ['C', 'C'], ['D', 'D']],
  );
  // Every line of each text appears once, in order, on its own side.
  assert.deepEqual(rows.filter((r) => r.left).map((r) => r.left.text), before.split('\n'));
  assert.deepEqual(rows.filter((r) => r.right).map((r) => r.right.text), after.split('\n'));
});

test('Windows line endings compare the same as plain ones', () => {
  assert.equal(hasChanges(lineDiff('a\r\nb', 'a\nb')), false);
});

test('the longest draft the app allows (10,000 lines, every one changed) finishes quickly, shown whole as removed and added', () => {
  const before = Array.from({ length: 10_000 }, (_, i) => `old ${i}`).join('\n');
  const after = Array.from({ length: 10_000 }, (_, i) => `new ${i}`).join('\n');
  const started = performance.now();
  const rows = lineDiff(before, after);
  assert.ok(performance.now() - started < 1000, 'under a second');
  assert.ok(10_000 * 10_000 > MAX_DIFF_CELLS, 'too big for the table, so it takes the plain view');
  assert.equal(rows.length, 10_000);
  assert.deepEqual(rows[0], { left: { text: 'old 0', kind: 'removed' }, right: { text: 'new 0', kind: 'added' } });
  assert.ok(rows.every((r) => r.left?.kind === 'removed' && r.right?.kind === 'added'));
});

test('a long text with one line changed: the shared start and end line up and only that line is marked, quickly', () => {
  const lines = Array.from({ length: 10_000 }, (_, i) => `line ${i}`);
  const changed = [...lines];
  changed[5_000] = 'a new middle line';
  const started = performance.now();
  const rows = lineDiff(lines.join('\n'), changed.join('\n'));
  assert.ok(performance.now() - started < 1000, 'under a second');
  assert.equal(rows.length, 10_000);
  const marked = rows.filter((r) => r.left?.kind !== 'same' || r.right?.kind !== 'same');
  assert.deepEqual(marked, [{ left: { text: 'line 5000', kind: 'removed' }, right: { text: 'a new middle line', kind: 'added' } }]);
  assert.deepEqual(rows[4_999], { left: { text: 'line 4999', kind: 'same' }, right: { text: 'line 4999', kind: 'same' } });
  assert.deepEqual(rows[9_999], { left: { text: 'line 9999', kind: 'same' }, right: { text: 'line 9999', kind: 'same' } });
});
