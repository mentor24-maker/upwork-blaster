// The line-by-line comparison behind the version history's side-by-side view (UB-29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasChanges, lineDiff } from '../lib/diff.ts';

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
