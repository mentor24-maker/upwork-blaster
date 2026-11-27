import { notFound } from 'next/navigation';
import { appDatabase } from '../../../lib/app_db.ts';
import { approvalState } from '../../../lib/approval.ts';
import { KIND_LABELS, proposalFlags } from '../../../lib/claimCheck.ts';
import { getProposal, MAX_ANSWER, MAX_DRAFT, MAX_QUESTION, unanswered } from '../../../lib/draft.ts';
import { getJob, type SavedJob } from '../../../lib/jobs.ts';
import { getEntry } from '../../../lib/portfolio.ts';
import { proposalVersions } from '../../../lib/proposalVersions.ts';
import { latestSent } from '../../../lib/sent.ts';

// Read on every visit: the draft and the answers change.
export const dynamic = 'force-dynamic';

const UNKNOWN = <em style={{ color: '#666' }}>unknown</em>;
const show = (v: string | number | null) => (v === null ? UNKNOWN : String(v));
const jobType = (t: SavedJob['jobType']) => (t === 'fixed' ? 'Fixed price' : t === 'hourly' ? 'Hourly' : UNKNOWN);
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const muted = { color: '#666', fontSize: '0.9em' } as const;
const column = { border: '1px solid #ccc', borderRadius: 6, padding: '0.75rem 1rem', minWidth: 0 } as const;
const prose = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 } as const;

const ERRORS: Record<string, string> = {
  'bad-form': 'That form did not say what to save, or what was typed is too long. Nothing was saved.',
  'too-many': 'Nothing was added: a proposal can hold at most 20 questions.',
};
const SAVED: Record<string, string> = {
  answer: 'Answer saved.',
  question: 'Question added.',
  draft: 'Draft saved. The claim check found nothing unproven in it.',
  'draft-flagged': 'Draft saved. The claim check flagged something in it: see below.',
};
const pick = (table: Record<string, string>, v: string | string[] | undefined) =>
  typeof v === 'string' && Object.hasOwn(table, v) ? table[v] : null;

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string | string[]; error?: string | string[] }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const db = appDatabase();
  const proposal = getProposal(db, Number(id));
  const job = proposal ? getJob(db, proposal.opportunityId) : undefined;
  if (!proposal || !job) notFound();
  const evidence = proposal.evidenceIds.map((e) => getEntry(db, e)?.project ?? `entry ${e} (since removed)`);
  const open = proposal.questions.filter(unanswered).length;
  // The claim check (lib/claimCheck.ts), worked out afresh on every visit.
  const flags = proposalFlags(db, proposal.id);
  const approval = approvalState(db, proposal.id);
  const sent = latestSent(db, proposal.id);
  const versionCount = proposalVersions(db, proposal.id).length;
  const done = pick(SAVED, saved);
  const problem = pick(ERRORS, error);

  return (
    <main>
      <p>
        <a href="/inbox">← Inbox</a>
      </p>
      <h1>Proposal workspace</h1>
      <p role="note" style={{ background: '#fff7e0', border: '1px solid #e0c060', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
        <strong>A draft only.</strong> Nothing has been sent to Upwork or anywhere else. The app never sends a proposal: you
        copy it into Upwork yourself.
      </p>
      {done ? <p role="status">{done}</p> : null}
      <p id="approval-state" data-approval={approval.state}>
        {approval.state === 'approved' ? (
          <strong style={{ color: '#2a6a34' }}>✓ Approved by you {when(approval.approval.approvedAt)} Mountain time.</strong>
        ) : approval.state === 'cancelled' ? (
          <strong style={{ color: '#a40000' }}>Your approval is gone: {approval.why}.</strong>
        ) : approval.state === 'on-hold' ? (
          <strong style={{ color: '#a40000' }}>Your approval is on hold: something now blocks it.</strong>
        ) : (
          <span style={muted}>Not approved yet.</span>
        )}{' '}
        <a href={`/proposals/${proposal.id}/review`}>
          {approval.state === 'approved' ? 'Copy it and mark it sent →' : 'Final review and approval →'}
        </a>
      </p>
      {sent ? (
        <p data-sent="by-dane">
          <strong>Sent by Dane</strong> (you said so) {when(sent.confirmedAt)} Mountain time. The app sent nothing.
        </p>
      ) : null}
      <p>
        <a id="version-history" href={`/proposals/${proposal.id}/versions`}>
          Version history ({versionCount})
        </a>
      </p>
      {problem ? (
        <p role="alert" style={{ color: '#a40000' }}>
          {problem}
        </p>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))', gap: '1rem' }}>
        <section id="job" style={column}>
          <h2 style={{ marginTop: 0 }}>The job</h2>
          <p>
            <strong>
              <a href={job.url} target="_blank" rel="noreferrer noopener">
                {job.title}
              </a>
            </strong>
          </p>
          <div>
            Budget: {show(job.budget)} · Type: {jobType(job.jobType)} · Posted: {show(job.postedAt)} · Connects:{' '}
            {show(job.connectsCost)}
          </div>
          <div>Client: {show(job.client)}</div>
          <hr />
          <pre style={prose}>{job.description}</pre>
        </section>

        <section id="draft" style={column}>
          <h2 style={{ marginTop: 0 }}>The draft</h2>
          {proposal.draft !== null ? (
            <>
              {flags.length > 0 ? (
                <div
                  id="claim-flags"
                  role="alert"
                  style={{ background: '#fdecec', border: '1px solid #d08080', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}
                >
                  <strong style={{ color: '#a40000' }} data-flag="blocks-approval">
                    ⚑ Blocks approval: {flags.length} claim{flags.length === 1 ? '' : 's'} you cannot back up yet
                  </strong>
                  <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                    {flags.map((f, i) => (
                      <li key={i} data-claim={f.kind} style={{ marginBottom: '0.5rem' }}>
                        <strong>{KIND_LABELS[f.kind]}:</strong> “{f.sentence}”
                        <div style={muted}>{f.why}</div>
                      </li>
                    ))}
                  </ol>
                  <p style={{ ...muted, marginBottom: 0 }}>Fix the sentence and save; the flag clears when the claim can be backed up.</p>
                </div>
              ) : (
                <p id="claim-flags" role="status" style={muted}>
                  Claim check: nothing unproven found (unfinished work shown as delivered, unapproved work, or a number with no
                  source).
                </p>
              )}
              <form method="post" action="/api/proposals">
                <input type="hidden" name="proposal" value={String(proposal.id)} />
                <input type="hidden" name="action" value="edit-draft" />
                <textarea
                  name="draft"
                  aria-label="Draft proposal"
                  rows={16}
                  required
                  maxLength={MAX_DRAFT}
                  defaultValue={proposal.draft}
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
                <button type="submit">Save draft</button>
              </form>
              <hr />
              <p style={muted}>
                {proposal.editedAt ? `Edited by you ${when(proposal.editedAt)} Mountain time. ` : null}
                {proposal.editedAt ? 'First written' : 'Written'} by the AI{' '}
                {proposal.draftedAt ? `${when(proposal.draftedAt)} Mountain time` : null}, from the job and only your
                portfolio entries approved for use:{' '}
                {evidence.length > 0 ? evidence.join('; ') : 'none were approved, so it cites no past work'}.
              </p>
            </>
          ) : (
            <>
              <p style={{ color: '#a40000' }}>
                No draft yet{proposal.draftProblem ? `: ${proposal.draftProblem}` : '.'}
              </p>
              <form method="post" action="/api/proposals">
                <input type="hidden" name="proposal" value={String(proposal.id)} />
                <input type="hidden" name="action" value="retry-draft" />
                <button type="submit">Write the draft again</button>
              </form>
            </>
          )}
        </section>
      </div>

      <section id="questions" style={{ marginTop: '1.5rem', maxWidth: '48rem' }}>
        <h2>Screening questions</h2>
        {proposal.questions.length === 0 ? (
          <p style={muted}>None found in the post. If the job asks any, add them below.</p>
        ) : (
          <p style={open > 0 ? { color: '#8a5a00' } : muted}>
            {open > 0 ? `${open} of ${proposal.questions.length} still need an answer.` : 'Every question has an answer.'}
          </p>
        )}
        <ol>
          {proposal.questions.map((q) => (
            <li key={q.id} id={`q-${q.id}`} style={{ marginBottom: '1rem' }}>
              <div>
                {q.question}{' '}
                {unanswered(q) ? (
                  <strong style={{ color: '#8a5a00' }} data-flag="needs-answer">
                    ⚑ Needs an answer
                  </strong>
                ) : null}
              </div>
              <form method="post" action="/api/proposals">
                <input type="hidden" name="proposal" value={String(proposal.id)} />
                <input type="hidden" name="action" value="answer" />
                <input type="hidden" name="question_id" value={String(q.id)} />
                <textarea
                  name="answer"
                  rows={3}
                  maxLength={MAX_ANSWER}
                  defaultValue={q.answer ?? ''}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                <button type="submit">Save answer</button>
              </form>
            </li>
          ))}
        </ol>
        <form method="post" action="/api/proposals">
          <input type="hidden" name="proposal" value={String(proposal.id)} />
          <input type="hidden" name="action" value="add-question" />
          <label>
            Add a question the job asks:{' '}
            <input name="question" maxLength={MAX_QUESTION} style={{ width: '28rem', maxWidth: '100%' }} />
          </label>{' '}
          <button type="submit">Add</button>
        </form>
      </section>
    </main>
  );
}
