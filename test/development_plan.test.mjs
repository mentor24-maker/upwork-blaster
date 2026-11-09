import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PLAN = new URL('../docs/DEVELOPMENT_PLAN.md', import.meta.url);

test('the development plan exists with its five sections, in order', () => {
  const text = readFileSync(PLAN, 'utf8');
  const wanted = [
    '## 1. Summary',
    '## 2. Review of the hand-off',
    '## 3. Decisions Dane needs to make',
    '## 4. Epics',
    '## 5. First-pass tasks',
  ];
  let from = 0;
  for (const heading of wanted) {
    const at = text.indexOf(`\n${heading}\n`, from);
    assert.ok(at >= 0, `missing or out of order: "${heading}"`);
    from = at + 1;
  }
});

test('the development plan carries no dollar figures', () => {
  // The repository is public; private earnings and pricing stay out of it.
  const text = readFileSync(PLAN, 'utf8');
  assert.doesNotMatch(text, /\$\s?\d/);
});
