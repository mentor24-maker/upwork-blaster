/**
 * A plain line-by-line comparison of two texts (UB-29), for the version
 * history's side-by-side view: old on the left, new on the right.
 *
 * It finds the longest run of lines the two texts share (the classic
 * "longest common subsequence"), keeps those lines side by side, and marks
 * every other line as removed (only in the old text) or added (only in the
 * new). A changed line is a removed line and an added line; when they sit
 * together they share a row, so the old wording lines up with the new.
 *
 * No package. The shared first and last lines are set aside before the
 * table is built, and a stretch too big for the table is shown whole as
 * removed and added (`MAX_DIFF_CELLS`), so even the longest draft the app
 * allows stays quick and small. Nothing here imports Next.js, so the tests run it under
 * `node --test`.
 */

export type DiffSide = { text: string; kind: 'same' | 'removed' | 'added' };

/** One row of the side-by-side view. A side is null where that text has no line. */
export type DiffRow = { left: DiffSide | null; right: DiffSide | null };

/** Empty text has no lines; otherwise every line, the last one included even when blank. */
const linesOf = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

/**
 * Above this many table cells (changed lines in the old text times changed
 * lines in the new) the lines are not matched up: the changed stretch is shown
 * as all removed on the left and all added on the right. Two million cells is
 * about 8 MB and a few milliseconds; a 10,000-line rewrite would otherwise
 * need a table of a hundred million.
 */
export const MAX_DIFF_CELLS = 2_000_000;

/** Compare `before` with `after`, line by line. Identical texts give rows that are all "same". */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = linesOf(before);
  const b = linesOf(after);

  // The lines both texts start and end with line up as they are; only the
  // stretch between them needs the table.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const rows: DiffRow[] = [];
  const same = (text: string) => rows.push({ left: { text, kind: 'same' }, right: { text, kind: 'same' } });
  for (let k = 0; k < head; k++) same(a[k]);
  for (const row of middleRows(midA, midB)) rows.push(row);
  for (let k = a.length - tail; k < a.length; k++) same(a[k]);
  return rows;
}

/** The changed stretch between the shared first and last lines. */
function middleRows(a: string[], b: string[]): DiffRow[] {
  const width = b.length + 1;
  const matchUp = (a.length + 1) * width <= MAX_DIFF_CELLS;
  // lcs[i * width + j]: how many lines a[i..] and b[j..] share, in order.
  const lcs = matchUp ? new Int32Array((a.length + 1) * width) : null;
  if (lcs) {
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
  }

  const rows: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  // Removed and added lines that sit together share rows, so a changed line lines up.
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      rows.push({
        left: k < removed.length ? { text: removed[k], kind: 'removed' } : null,
        right: k < added.length ? { text: added[k], kind: 'added' } : null,
      });
    }
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (lcs && i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      rows.push({ left: { text: a[i], kind: 'same' }, right: { text: b[j], kind: 'same' } });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || !lcs || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) {
      added.push(b[j++]);
    } else {
      removed.push(a[i++]);
    }
  }
  flush();
  return rows;
}

/** True when the two texts differ in any line. */
export const hasChanges = (rows: DiffRow[]) => rows.some((r) => r.left?.kind !== 'same' || r.right?.kind !== 'same');
