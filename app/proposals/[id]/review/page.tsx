import { notFound } from 'next/navigation';
import { appDatabase } from '../../../../lib/app_db.ts';
import { approvalState, fingerprintOf, reviewBlock } from '../../../../lib/approval.ts';
import { KIND_LABELS } from '../../../../lib/claimCheck.ts';
import { getProposal, unanswered } from '../../../../lib/draft.ts';
import { getJob } from '../../../../lib/jobs.ts';

// The final review screen (task 3.3, hand-off §5D): exactly what Dane would
// send, every screening answer, anything unresolved, and the one button that
// approves this exact version. Read on every visit: approval is worked out
// afresh from what the proposal says now.
export const dynamic = 'force-dynamic';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const muted = { color: '#666', fontSize: '0.9em' } as const;
const box = { border: '1px solid #ccc', borderRadius: 6, padding: '0.75rem 1rem' } as const;
const prose = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 } as const;
const banner = (bg: string, border: string) =>
  ({ background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: '0.5rem 0.75rem' }) as const;

const ERRORS: Record<string, string> = {
  'bad-form': 'That approval did not say which version it was for. Nothing was approved.',
  changed:
    'Nothing was approved: the proposal changed after this screen was opened, so the version you clicked on is not the one saved. Read it again below.',
  blocked: 'Nothing was approved: something below still blocks approval.',
};
const DONE: Record<string, string> = {
  approved: 'Approved. This exact version is the one you will send.',
  already: 'This exact version was already approved. Nothing changed.',
};
const pick = (table: Record<string, string>, v: string | string[] | undefined) =>
  typeof v === 'string' && Object.hasOwn(table, v) ? table[v] : null;

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string | string[]; error?: string | string[] }>;
}) {
  const { id } = await params;
  const { done, error } = await searchParams;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const db = appDatabase();
  const proposal = getProposal(db, Number(id));
  const job = proposal ? getJob(db, proposal.opportunityId) : undefined;
  if (!proposal || !job) notFound();
  const block = reviewBlock(db, proposal.id);
  const state = approvalState(db, proposal.id);
  const fingerprint = fingerprintOf(proposal);
  const ok = pick(DONE, done);
  const problem = pick(ERRORS, error);
  const workspace = `/proposals/${proposal.id}`;

  return (
    <main style={{ maxWidth: '48rem' }}>
      <p>
        <a href={workspace}>← Back to the workspace to edit</a>
      </p>
      <h1>Final review</h1>
      <p style={muted}>
        For: <strong>{job.title}</strong>
      </p>
      <p role="note" style={banner('#fff7e0', '#e0c060')}>
        <strong>Nothing is sent from here.</strong> Approving records that this exact text and these exact answers are the
        version you will copy into Upwork yourself. Any change afterwards cancels the approval.
      </p>
      {ok ? <p role="status">{ok}</p> : null}
      {problem ? (
        <p role="alert" style={{ color: '#a40000' }}>
          {problem}
        </p>
      ) : null}

      <section id="approval" style={{ margin: '1rem 0' }}>
        {state.state === 'approved' ? (
          <p data-approval="approved" role="status" style={banner('#e8f6ea', '#6aa874')}>
            <strong>✓ Approved</strong> by you {when(state.approval.approvedAt)} Mountain time. What is shown below is exactly
            what you approved.
          </p>
        ) : state.state === 'cancelled' ? (
          <p data-approval="cancelled" role="alert" style={banner('#fdecec', '#d08080')}>
            <strong>Your approval is gone.</strong> You approved this proposal {when(state.approval.approvedAt)} Mountain
            time, but {state.why}
            {state.approval.cancelledAt ? ` (${when(state.approval.cancelledAt)} Mountain time)` : ''}. Read it again and
            approve this version if it is the one you will send.
          </p>
        ) : state.state === 'on-hold' ? (
          <p data-approval="on-hold" role="alert" style={banner('#fdecec', '#d08080')}>
            <strong>Your approval is on hold.</strong> The words are the ones you approved{' '}
            {when(state.approval.approvedAt)} Mountain time, but something below now blocks approval. Until it is fixed,
            this proposal is not approved.
          </p>
        ) : (
          <p data-approval="none" style={muted}>
            Not approved yet.
          </p>
        )}
      </section>

      <section id="unresolved" style={{ margin: '1rem 0' }}>
        <h2>Unresolved</h2>
        {block.blocked ? (
          <div role="alert" style={banner('#fdecec', '#d08080')}>
            <strong style={{ color: '#a40000' }} data-flag="blocks-approval">
              ⚑ Blocks approval
            </strong>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
              {block.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {block.flags.length > 0 ? (
              <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                {block.flags.map((f, i) => (
                  <li key={i} data-claim={f.kind} style={{ marginBottom: '0.5rem' }}>
                    <strong>{KIND_LABELS[f.kind]}:</strong> “{f.sentence}”<div style={muted}>{f.why}</div>
                  </li>
                ))}
              </ol>
            ) : null}
            <p style={{ ...muted, marginBottom: 0 }}>
              Fix these in the <a href={workspace}>workspace</a>, then come back here to approve.
            </p>
          </div>
        ) : (
          <p style={muted}>Nothing: the claim check found nothing unproven, and every screening question has an answer.</p>
        )}
      </section>

      <section id="text" style={{ margin: '1rem 0' }}>
        <h2>The exact text you would send</h2>
        <div style={box}>
          {proposal.draft !== null ? (
            <pre style={prose} data-review="draft">
              {proposal.draft}
            </pre>
          ) : (
            <p style={{ color: '#a40000', margin: 0 }}>There is no draft yet.</p>
          )}
        </div>
      </section>

      <section id="answers" style={{ margin: '1rem 0' }}>
        <h2>Screening answers</h2>
        {proposal.questions.length === 0 ? (
          <p style={muted}>This job has no screening questions.</p>
        ) : (
          <ol>
            {proposal.questions.map((q) => (
              <li key={q.id} style={{ marginBottom: '0.75rem' }}>
                <div>
                  <strong>{q.question}</strong>
                </div>
                {unanswered(q) ? (
                  <strong style={{ color: '#8a5a00' }} data-flag="needs-answer">
                    ⚑ No answer yet
                  </strong>
                ) : (
                  <pre style={prose} data-review="answer">
                    {q.answer}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {state.state !== 'approved' && !block.blocked ? (
        <form method="post" action="/api/approvals">
          <input type="hidden" name="proposal" value={String(proposal.id)} />
          <input type="hidden" name="action" value="approve" />
          <input type="hidden" name="fingerprint" value={fingerprint} />
          <button type="submit">Approve this exact version</button>
        </form>
      ) : null}
      <p style={muted}>Version fingerprint: {fingerprint.slice(0, 12)}</p>
    </main>
  );
}
