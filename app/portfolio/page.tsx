import { appDatabase } from '../../lib/app_db.ts';
import {
  listEntries,
  MAX_LINKS,
  portfolioFormMessage,
  STATUS_LABELS,
  STATUSES,
  type SavedEntry,
} from '../../lib/portfolio.ts';

const field = { display: 'block', marginBottom: '1rem' } as const;
const input = { display: 'block', width: '100%', maxWidth: '40rem', marginTop: '0.25rem' } as const;
const hint = { display: 'block', color: '#666', fontSize: '0.9em' } as const;
const tag = (approved: boolean) =>
  ({
    display: 'inline-block',
    padding: '0 0.4rem',
    marginLeft: '0.5rem',
    border: '1px solid',
    borderRadius: '0.25rem',
    fontSize: '0.85em',
    color: approved ? '#1a6b1a' : '#8a5a00',
  }) as const;
const savedAt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });

/** The fields shared by the add form and each entry's edit form. */
function EntryFields({ entry }: { entry?: SavedEntry }) {
  return (
    <>
      <label style={field}>
        Project
        <input style={input} name="project" required maxLength={200} defaultValue={entry?.project ?? ''} />
      </label>
      <label style={field}>
        Status
        <select style={{ ...input, width: 'auto' }} name="status" defaultValue={entry?.status ?? 'delivered'}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label style={field}>
        Features
        <span style={hint}>What it does or shows, in your words. A proposal may quote this.</span>
        <textarea style={input} name="features" rows={4} defaultValue={entry?.features ?? ''} />
      </label>
      <label style={field}>
        Links
        <span style={hint}>One web address per line (up to {MAX_LINKS}).</span>
        <textarea style={input} name="links" rows={3} defaultValue={entry?.links.join('\n') ?? ''} />
      </label>
      <label style={field}>
        <input type="checkbox" name="approvedForUse" value="1" defaultChecked={entry?.approvedForUse ?? false} /> Approved
        for use
        <span style={hint}>Only approved entries can ever be cited in a proposal.</span>
      </label>
    </>
  );
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; removed?: string | string[]; error?: string | string[]; id?: string | string[] }>;
}) {
  const { saved, removed, error, id } = await searchParams;
  const entries = listEntries(appDatabase());
  const justSaved = typeof saved === 'string' ? entries.find((e) => String(e.id) === saved) : undefined;
  const message = portfolioFormMessage(error);
  const failedEdit = typeof id === 'string' ? id : undefined;
  const approved = entries.filter((e) => e.approvedForUse).length;

  return (
    <main>
      <p>
        <a href="/">← Home</a>
      </p>
      <h1>Portfolio</h1>
      <p>
        The projects and facts a proposal is allowed to cite. {entries.length} entr{entries.length === 1 ? 'y' : 'ies'},{' '}
        {approved} approved for use.
      </p>
      {justSaved ? <p role="status">Saved “{justSaved.project}”.</p> : null}
      {removed === '1' ? <p role="status">Entry removed.</p> : null}
      {message ? (
        <p role="alert" style={{ color: '#a40000' }}>
          {message}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p>No entries yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {entries.map((e) => (
            <li key={e.id} id={`entry-${e.id}`} style={{ borderTop: '1px solid #ddd', padding: '0.75rem 0' }}>
              <strong>{e.project}</strong>
              <span style={tag(e.status === 'delivered')}>{STATUS_LABELS[e.status]}</span>
              <span style={tag(e.approvedForUse)}>{e.approvedForUse ? 'Approved for use' : 'Not approved'}</span>
              {e.features ? <p style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0' }}>{e.features}</p> : null}
              {e.links.length > 0 ? (
                <ul style={{ margin: '0.25rem 0' }}>
                  {e.links.map((l) => (
                    <li key={l}>
                      <a href={l} target="_blank" rel="noreferrer noopener">
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div style={{ color: '#666', fontSize: '0.9em' }}>Last saved {savedAt(e.updatedAt)} Mountain time</div>
              <details open={failedEdit === String(e.id)} style={{ marginTop: '0.5rem' }}>
                <summary>Edit</summary>
                <form method="post" action="/api/portfolio" style={{ marginTop: '0.5rem' }}>
                  <input type="hidden" name="action" value="update" />
                  <input type="hidden" name="id" value={e.id} />
                  <EntryFields entry={e} />
                  <button type="submit">Save changes</button>
                </form>
              </details>
              <form method="post" action="/api/portfolio" style={{ marginTop: '0.5rem' }}>
                <input type="hidden" name="action" value="remove" />
                <input type="hidden" name="id" value={e.id} />
                <label style={{ marginRight: '0.5rem' }}>
                  <input type="checkbox" name="confirm" required /> Yes, remove this entry for good
                </label>
                <button type="submit">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2>Add an entry</h2>
      <form method="post" action="/api/portfolio">
        <input type="hidden" name="action" value="add" />
        <EntryFields />
        <button type="submit">Add to portfolio</button>
      </form>
    </main>
  );
}
