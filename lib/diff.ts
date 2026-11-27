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
 * No package: a proposal is a few dozen lines, so the simple table method is
 * plenty fast. Nothing here imports Next.js, so the tests run it under
 * `node --test`.
 */

export type DiffSide = { text: string; kind: 'same' | 'removed' | 'added' };

/** One row of the side-by-side view. A side is null where that text has no line. */
export type DiffRow = { left: DiffSide | null; right: DiffSide | null };

/** Empty text has no lines; otherwise every line, the last one included even when blank. */
const linesOf = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

/** Compare `before` with `after`, line by line. Identical texts give rows that are all "same". */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = linesOf(before);
  const b = linesOf(after);
  // lcs[i][j]: how many lines a[i..] and b[j..] share, in order.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
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
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      rows.push({ left: { text: a[i], kind: 'same' }, right: { text: b[j], kind: 'same' } });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
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
