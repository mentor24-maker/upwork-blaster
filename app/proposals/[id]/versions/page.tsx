import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { appDatabase } from '../../../../lib/app_db.ts';
import type { DiffRow, DiffSide } from '../../../../lib/diff.ts';
import { getProposal } from '../../../../lib/draft.ts';
import type { VersionChange } from '../../../../lib/proposalVersions.ts';
import { compareVersions, defaultPair, versionHistory, type MarkedVersion } from '../../../../lib/versionHistory.ts';

// Read on every visit: a new edit adds a version. This page only reads.
export const dynamic = 'force-dynamic';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const muted = { color: '#666', fontSize: '0.9em' } as const;
const CHANGE: Record<VersionChange, string> = {
  'first-draft': 'First draft',
  draft: 'Draft edited',
  answer: 'Answer changed',
  question: 'Question added',
};
const whose = (v: MarkedVersion) => (v.author === 'AI' ? 'the AI’s words' : 'your edit');

const SIDE_STYLE: Record<DiffSide['kind'], CSSProperties> = {
  same: {},
  removed: { background: '#fdecec', color: '#7a0000' },
  added: { background: '#e6f4ea', color: '#1d5a2a' },
};
const SIGN: Record<DiffSide['kind'], string> = { same: ' ', removed: '−', added: '+' };
const cell = { padding: '0.1rem 0.5rem', verticalAlign: 'top', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', width: '50%' } as const;

function Side({ side }: { side: DiffSide | null }) {
  if (!side) return <td style={{ ...cell, background: '#f4f4f4' }} />;
  return (
    <td style={{ ...cell, ...SIDE_STYLE[side.kind] }} data-diff={side.kind}>
      <span aria-hidden="true" style={{ display: 'inline-block', width: '1.2em', fontFamily: 'monospace' }}>
        {SIGN[side.kind]}
      </span>
      {side.kind === 'removed' ? <span className="sr-only">Removed: </span> : side.kind === 'added' ? <span className="sr-only">Added: </span> : null}
      {side.text === '' ? ' ' : side.text}
    </td>
  );
}

function DiffTable({ rows, older, newer, empty = 'Empty in both versions.' }: { rows: DiffRow[]; older: number; newer: number; empty?: string }) {
  if (rows.length === 0) return <p style={muted}>{empty}</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', border: '1px solid #ccc' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Version {older} (older)</th>
          <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Version {newer} (newer)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <Side side={r.left} />
            <Side side={r.right} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Marks({ v }: { v: MarkedVersion }) {
  return (
    <>
      {v.approvals.map((a) => (
        <div key={`a${a.approvalId}`} data-mark="approved" data-stands={a.stands ? 'yes' : 'no'}>
          <strong style={{ color: '#2a6a34' }}>✓ Approved</strong> by you {when(a.approvedAt)} Mountain time
          {a.stands ? (
            ' (still stands)'
          ) : (
            <span style={{ color: '#a40000' }}>
              {' '}
              (later cancelled {a.cancelledAt ? `${when(a.cancelledAt)} Mountain time` : ''}: {a.cancelledWhy})
            </span>
          )}
        </div>
      ))}
      {v.sent.map((s) => (
        <div key={`s${s.sentId}`} data-mark="sent">
          <strong>✉ Sent</strong>: you marked it sent {when(s.confirmedAt)} Mountain time.
        </div>
      ))}
    </>
  );
}

const pickNo = (v: string | string[] | undefined) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : v === undefined ? null : NaN);

export default async function VersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string | string[]; b?: string | string[] }>;
}) {
  const { id } = await params;
  const { a, b } = await searchParams;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const db = appDatabase();
  const proposal = getProposal(db, Number(id));
  if (!proposal) notFound();
  const history = versionHistory(db, proposal.id);

  const fallback = defaultPair(history);
  const askedA = pickNo(a);
  const askedB = pickNo(b);
  // A number that is not one of this proposal's versions is not found, never another proposal's text.
  if (Number.isNaN(askedA) || Number.isNaN(askedB)) notFound();
  const pair: [number, number] | undefined =
    askedA !== null || askedB !== null ? [askedA ?? fallback?.[0] ?? 0, askedB ?? fallback?.[1] ?? 0] : fallback;
  const comparison = pair ? compareVersions(history, pair[0], pair[1]) : undefined;
  if (pair && !comparison) notFound();

  return (
    <main>
      <style>{'.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'}</style>
      <p>
        <a href={`/proposals/${proposal.id}`}>← Proposal workspace</a>
      </p>
      <h1>Version history</h1>
      <p style={muted}>
        Every saved version of this proposal, newest first. Nothing on this page changes a version, the draft, an approval or a
        send.
      </p>

      {history.versions.length === 0 ? (
        <p>No versions saved yet: one is kept as soon as the proposal has a draft.</p>
      ) : (
        <>
          <ol reversed id="versions" style={{ paddingLeft: '1.5rem' }}>
            {history.versions.map((v) => (
              <li key={v.versionNo} id={`v-${v.versionNo}`} data-version={v.versionNo} style={{ marginBottom: '0.75rem' }}>
                <strong>Version {v.versionNo}</strong>: {CHANGE[v.change]}, {whose(v)}, {when(v.savedAt)} Mountain time.
                <Marks v={v} />
              </li>
            ))}
          </ol>
          {history.unmatchedApprovals.length > 0 ? (
            <p style={muted}>
              {history.unmatchedApprovals.length} approval{history.unmatchedApprovals.length === 1 ? '' : 's'} match no saved
              version (made before versions were kept).
            </p>
          ) : null}
          {history.unmatchedSent.length > 0 ? (
            <p data-mark="sent-unmatched">
              <strong>✉ Sent</strong>, but the version you sent is not in this list (approved before versions were kept):{' '}
              {history.unmatchedSent.map((s) => `you marked it sent ${when(s.confirmedAt)} Mountain time`).join('; ')}.
            </p>
          ) : null}

          <section id="compare" style={{ marginTop: '1.5rem' }}>
            <h2>Compare two versions</h2>
            <form method="get">
              <label>
                Older:{' '}
                <select name="a" defaultValue={String(comparison?.older.versionNo ?? '')}>
                  {history.versions.map((v) => (
                    <option key={v.versionNo} value={v.versionNo}>
                      Version {v.versionNo}
                    </option>
                  ))}
                </select>
              </label>{' '}
              <label>
                Newer:{' '}
                <select name="b" defaultValue={String(comparison?.newer.versionNo ?? '')}>
                  {history.versions.map((v) => (
                    <option key={v.versionNo} value={v.versionNo}>
                      Version {v.versionNo}
                    </option>
                  ))}
                </select>
              </label>{' '}
              <button type="submit">Compare</button>
            </form>

            {comparison ? (
              <>
                {comparison.older.versionNo === comparison.newer.versionNo ? (
                  <p style={muted}>Only one version is picked, so there is nothing to compare it with.</p>
                ) : null}
                <h3>The draft</h3>
                <DiffTable rows={comparison.draft} older={comparison.older.versionNo} newer={comparison.newer.versionNo} />
                {comparison.answers.length > 0 ? <h3>Screening answers</h3> : null}
                {comparison.answers.map((ans, i) => (
                  <div key={i} style={{ marginBottom: '1rem' }}>
                    <p style={{ marginBottom: '0.25rem' }}>
                      <strong>{ans.question}</strong>
                      {ans.in === 'newer' ? (
                        <span style={muted}> (question added after version {comparison.older.versionNo})</span>
                      ) : ans.in === 'older' ? (
                        <span style={muted}> (question gone by version {comparison.newer.versionNo})</span>
                      ) : null}
                    </p>
                    <DiffTable
                      rows={ans.rows}
                      older={comparison.older.versionNo}
                      newer={comparison.newer.versionNo}
                      empty={
                        ans.in === 'newer'
                          ? `Not asked yet in version ${comparison.older.versionNo}, and not answered yet in version ${comparison.newer.versionNo}.`
                          : ans.in === 'older'
                            ? `It had no answer in version ${comparison.older.versionNo}.`
                            : undefined
                      }
                    />
                  </div>
                ))}
              </>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
