import { appDatabase } from '../../lib/app_db.ts';
import {
  buildPipeline,
  MAX_NEXT_ACTION,
  MAX_NOTE,
  PIPELINE_LABELS,
  PIPELINE_STATUSES,
  type PipelineCard,
} from '../../lib/pipeline.ts';

// The Pipeline board (task 3.5): every job Dane marked "I sent it", in a
// column for the status he set, with his notes and next action. The app
// never sets a status itself. Read on every visit: the board changes with
// each move.
export const dynamic = 'force-dynamic';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const muted = { color: '#666', fontSize: '0.9em' } as const;
const prose = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 } as const;
const card = { border: '1px solid #ccc', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '0.75rem', background: '#fff' } as const;

const ERRORS: Record<string, string> = {
  'bad-form': 'That form did not say what to change. Nothing was saved.',
  'not-sent': 'Nothing was saved: that proposal is not on the board, because it was never marked “I sent it”.',
  empty: 'Nothing was saved: the note was empty.',
};
const DONE: Record<string, string> = {
  moved: 'Moved.',
  already: 'It was already in that column. Nothing changed.',
  noted: 'Note added.',
  next: 'Next action saved.',
  cleared: 'Next action cleared.',
};
const pick = (table: Record<string, string>, v: string | string[] | undefined) =>
  typeof v === 'string' && Object.hasOwn(table, v) ? table[v] : null;

type Notice = { ok: string | null; problem: string | null };

function Message({ ok, problem }: Notice) {
  return (
    <>
      {ok ? <p role="status">{ok}</p> : null}
      {problem ? (
        <p role="alert" style={{ color: '#a40000' }}>
          {problem}
        </p>
      ) : null}
    </>
  );
}

function Card({ c, notice }: { c: PipelineCard; notice: Notice | null }) {
  const id = String(c.proposalId);
  return (
    <article id={`job-${id}`} data-pipeline-card={id} data-status={c.status} style={card}>
      {notice ? <Message {...notice} /> : null}
      <strong style={{ overflowWrap: 'anywhere' }}>{c.title}</strong>
      <div style={muted}>
        Sent by you {when(c.sentAt)} MT
        {c.status !== 'sent' ? ` · ${PIPELINE_LABELS[c.status]} since ${when(c.statusSince)} MT` : ''}
      </div>
      <div style={muted}>
        <a href={`/proposals/${id}/review`}>What you sent</a> ·{' '}
        <a href={c.url} target="_blank" rel="noreferrer noopener">
          Job on Upwork
        </a>
      </div>

      <form method="post" action="/api/pipeline" style={{ marginTop: '0.5rem' }}>
        <input type="hidden" name="proposal" value={id} />
        <input type="hidden" name="action" value="move" />
        <label>
          Move to{' '}
          <select name="status" defaultValue={c.status}>
            {PIPELINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PIPELINE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>{' '}
        <button type="submit">Move</button>
      </form>

      <form method="post" action="/api/pipeline" style={{ marginTop: '0.5rem' }}>
        <input type="hidden" name="proposal" value={id} />
        <input type="hidden" name="action" value="next" />
        <label>
          Next action
          <br />
          <input
            name="text"
            defaultValue={c.nextAction ?? ''}
            maxLength={MAX_NEXT_ACTION}
            placeholder="e.g. Reply to their question by Friday"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </label>
        <button type="submit">Save next action</button>
      </form>

      <form method="post" action="/api/pipeline" style={{ marginTop: '0.5rem' }}>
        <input type="hidden" name="proposal" value={id} />
        <input type="hidden" name="action" value="note" />
        <label>
          Add a note
          <br />
          <textarea name="text" rows={2} maxLength={MAX_NOTE} style={{ width: '100%', boxSizing: 'border-box' }} />
        </label>
        <button type="submit">Add note</button>
      </form>

      {c.notes.length > 0 ? (
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
          {c.notes.map((n) => (
            <li key={n.id} data-pipeline-note={String(n.id)} style={{ marginBottom: '0.4rem' }}>
              <pre style={prose}>{n.note}</pre>
              <span style={muted}>{when(n.createdAt)} MT</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string | string[]; error?: string | string[]; job?: string | string[] }>;
}) {
  const { done, error, job } = await searchParams;
  const board = buildPipeline(appDatabase());
  const notice: Notice = { ok: pick(DONE, done), problem: pick(ERRORS, error) };
  // A message about one job shows in that job's card, where he clicked; one
  // about no job on the board (or none named) shows at the top.
  const jobId = typeof job === 'string' && /^\d{1,12}$/.test(job) ? Number(job) : null;
  const onBoard = jobId !== null && board.columns.some((col) => col.cards.some((c) => c.proposalId === jobId));

  return (
    <main>
      <p>
        <a href="/">← Home</a>
      </p>
      <h1>Pipeline</h1>
      <p style={muted}>
        Every job you marked “I sent it”. You set each status yourself: the app has no connection to Upwork and never
        guesses.
      </p>
      {onBoard ? null : <Message {...notice} />}
      {board.total === 0 ? (
        <p data-pipeline="empty">
          Nothing here yet. When you send an approved proposal in Upwork and press “I sent it” on its review screen, the job
          appears here.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
            gap: '0.75rem',
            alignItems: 'start',
          }}
        >
          {board.columns.map((col) => (
            <section
              key={col.status}
              data-pipeline-column={col.status}
              style={{ background: '#f4f5f7', borderRadius: 6, padding: '0.5rem', minWidth: 0 }}
            >
              <h2 style={{ fontSize: '1.05em', margin: '0.25rem 0 0.6rem' }}>
                {col.label} <span style={muted}>({col.cards.length})</span>
              </h2>
              {col.cards.length === 0 ? <p style={muted}>None.</p> : col.cards.map((c) => (
                    <Card key={c.proposalId} c={c} notice={onBoard && c.proposalId === jobId ? notice : null} />
                  ))}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
