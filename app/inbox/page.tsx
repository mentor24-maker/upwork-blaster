import { appDatabase } from '../../lib/app_db.ts';
import { buildInbox, DECISION_LABELS, getDecision, MAX_REASON, type Card } from '../../lib/inbox.ts';
import { getJob, type SavedJob } from '../../lib/jobs.ts';

// Read on every visit: the cards change with each saved job and each decision.
export const dynamic = 'force-dynamic';

const UNKNOWN = <em style={{ color: '#666' }}>unknown</em>;
const show = (v: string | number | null) => (v === null ? UNKNOWN : String(v));
const jobType = (t: SavedJob['jobType']) => (t === 'fixed' ? 'Fixed price' : t === 'hourly' ? 'Hourly' : UNKNOWN);
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const box = { border: '1px solid #ccc', borderRadius: 6, padding: '0.75rem 1rem', margin: '0 0 1rem', maxWidth: '48rem' } as const;
const muted = { color: '#666', fontSize: '0.9em' } as const;

const ERRORS: Record<string, string> = {
  'bad-decision': 'That button did not say which job or which decision. Nothing was saved.',
  'not-found': 'That job is no longer saved. Nothing was saved.',
};

function Buttons({ card }: { card: Card }) {
  const id = String(card.job.id);
  return (
    <form method="post" action="/api/decisions" style={{ marginTop: '0.5rem' }}>
      <input type="hidden" name="id" value={id} />
      <label style={{ display: 'block', marginBottom: '0.25rem' }}>
        Reason (optional):{' '}
        <input name="reason" maxLength={MAX_REASON} style={{ width: '24rem', maxWidth: '100%' }} />
      </label>
      <button type="submit" name="decision" value="pursue">
        Pursue
      </button>{' '}
      <button type="submit" name="decision" value="pass">
        Pass
      </button>{' '}
      <button type="submit" name="decision" value="revisit">
        Revisit
      </button>
    </form>
  );
}

function Decision({ card }: { card: Card }) {
  const d = card.decision;
  if (!d) return null;
  return (
    <div style={muted}>
      <strong>{DECISION_LABELS[d.decision]}</strong> since {when(d.createdAt)} Mountain time
      {d.reason ? <> — “{d.reason}”</> : null}
    </div>
  );
}

function Facts({ job }: { job: SavedJob }) {
  return (
    <>
      <div>
        Budget: {show(job.budget)} · Type: {jobType(job.jobType)} · Posted: {show(job.postedAt)} · Connects:{' '}
        {show(job.connectsCost)}
      </div>
      <div>Client: {show(job.client)}</div>
    </>
  );
}

function Title({ job }: { job: SavedJob }) {
  return (
    <a href={job.url} target="_blank" rel="noreferrer noopener">
      {job.title}
    </a>
  );
}

function RankedCard({ card }: { card: Card }) {
  return (
    <li id={`job-${card.job.id}`} style={box}>
      <div style={{ fontSize: '1.1em' }}>
        <strong>
          #{card.rank} · <Title job={card.job} />
        </strong>
      </div>
      <div>
        Fit score: <strong>{card.score}</strong> of 100 · confidence {card.confidence}
      </div>
      <Facts job={card.job} />
      <div>Need: {card.need}</div>
      <div>Best portfolio evidence: {card.portfolioEvidence ?? <em>none of your approved projects matched</em>}</div>
      <div>Biggest unknown: {card.principalUncertainty ?? <em>none</em>}</div>
      <div>Your time it would take: {show(card.humanInvolvement)}</div>
      {card.flags.length > 0 ? (
        <div style={{ color: '#8a5a00' }}>To check: {card.flags.join('; ')}</div>
      ) : null}
      <details>
        <summary>Why this score</summary>
        <ul>
          {card.reasons.map((r) => (
            <li key={r.label}>
              {r.label} (weight {r.weight}): {r.score}
              {r.evidence.length > 0 ? ` — ${r.evidence.join('; ')}` : ' — nothing known, scored in the middle'}
            </li>
          ))}
        </ul>
      </details>
      <Decision card={card} />
      <Buttons card={card} />
    </li>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ decided?: string | string[]; error?: string | string[] }>;
}) {
  const { decided, error } = await searchParams;
  const db = appDatabase();
  const inbox = buildInbox(db);
  const done = typeof decided === 'string' && /^\d{1,12}$/.test(decided) ? getDecision(db, Number(decided)) : undefined;
  const doneJob = done ? getJob(db, done.opportunityId) : undefined;
  const problem = typeof error === 'string' && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null;
  const empty = inbox.top.length + inbox.more.length + inbox.excluded.length + inbox.notScored.length + inbox.passed.length === 0;

  return (
    <main>
      <p>
        <a href="/">← Home</a>
      </p>
      <h1>Inbox</h1>
      <p style={muted}>
        Your saved jobs, best fit first. Pursue, Pass or Revisit each one. Passing never changes your preferences.
      </p>
      {done && doneJob ? (
        <p role="status">
          {DECISION_LABELS[done.decision]}: “{doneJob.title}”.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" style={{ color: '#a40000' }}>
          {problem}
        </p>
      ) : null}

      {empty ? (
        <p>
          No jobs saved yet. <a href="/jobs/new">Add a job</a>.
        </p>
      ) : null}

      {inbox.top.length > 0 ? (
        <section>
          <h2>Top {inbox.top.length}</h2>
          <ol style={{ listStyle: 'none', padding: 0 }}>
            {inbox.top.map((c) => (
              <RankedCard key={c.job.id} card={c} />
            ))}
          </ol>
        </section>
      ) : null}

      {inbox.more.length > 0 ? (
        <section>
          <h2>More jobs ({inbox.more.length})</h2>
          <ol style={{ listStyle: 'none', padding: 0 }}>
            {inbox.more.map((c) => (
              <RankedCard key={c.job.id} card={c} />
            ))}
          </ol>
        </section>
      ) : null}

      {inbox.excluded.length > 0 ? (
        <section id="excluded">
          <h2>Set aside by your exclusions ({inbox.excluded.length})</h2>
          <p style={muted}>Not scored and not ranked: each met one of your hard exclusions.</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {inbox.excluded.map((c) => (
              <li key={c.job.id} id={`job-${c.job.id}`} style={box}>
                <strong>
                  <Title job={c.job} />
                </strong>
                {c.exclusions.map((e) => (
                  <div key={e.rule} style={{ color: '#a40000' }}>
                    Excluded by “{e.rule}”: {e.evidence}
                  </div>
                ))}
                <Facts job={c.job} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inbox.notScored.length > 0 ? (
        <section id="not-scored">
          <h2>Not scored ({inbox.notScored.length})</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {inbox.notScored.map((c) => (
              <li key={c.job.id} id={`job-${c.job.id}`} style={box}>
                <strong>
                  <Title job={c.job} />
                </strong>
                <div style={{ color: '#a40000' }}>
                  {c.job.scoringProblem ? `Scoring it failed (${c.job.scoringProblem}).` : 'It has not been scored yet.'}
                </div>
                <Facts job={c.job} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inbox.passed.length > 0 ? (
        <section id="passed">
          <details>
            <summary>
              <strong>Passed ({inbox.passed.length})</strong>: out of the inbox, kept here
            </summary>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {inbox.passed.map((c) => (
                <li key={c.job.id} id={`job-${c.job.id}`} style={box}>
                  <strong>
                    <Title job={c.job} />
                  </strong>
                  {c.score !== null ? <span style={muted}> · fit score {c.score}</span> : null}
                  <Decision card={c} />
                  <form method="post" action="/api/decisions" style={{ marginTop: '0.5rem' }}>
                    <input type="hidden" name="id" value={String(c.job.id)} />
                    <button type="submit" name="decision" value="revisit">
                      Bring back (Revisit)
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </main>
  );
}
