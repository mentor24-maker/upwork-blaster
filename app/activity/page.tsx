import { appDatabase } from '../../lib/app_db.ts';
import { activityCount, activityLines, DEFAULT_LIMIT } from '../../lib/activity.ts';

// The activity log: what you and the AI did, newest first, in Mountain time
// (lib/activity.ts writes each line from the save it describes). Read on
// every visit: it grows with each click.
export const dynamic = 'force-dynamic';

const muted = { color: '#666', fontSize: '0.9em' } as const;

export default function ActivityPage() {
  const db = appDatabase();
  const lines = activityLines(db);
  const total = activityCount(db);
  return (
    <main>
      <p>
        <a href="/">Home</a>
      </p>
      <h1>Activity</h1>
      <p style={muted}>What you and the AI did in Upwork Blaster, newest first. Times are Mountain time.</p>
      {lines.length === 0 ? (
        <p>Nothing has happened yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0 }}>
          {lines.map((l) => (
            <li key={l.id} data-activity={l.id} style={{ borderTop: '1px solid #ddd', padding: '0.5rem 0' }}>
              <div style={muted}>
                {l.when} · {l.who}
              </div>
              <div style={{ overflowWrap: 'anywhere' }}>
                {l.what} {l.link ? <a href={l.link}>Open</a> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {total > lines.length ? (
        <p style={muted}>
          Showing the newest {DEFAULT_LIMIT} of {total}.
        </p>
      ) : null}
    </main>
  );
}
