import { appDatabase } from '../../lib/app_db.ts';
import { listJobs, type SavedJob } from '../../lib/jobs.ts';

const UNKNOWN = <em style={{ color: '#666' }}>unknown</em>;
const show = (v: string | number | null) => (v === null ? UNKNOWN : String(v));
const jobType = (t: SavedJob['jobType']) => (t === 'fixed' ? 'Fixed price' : t === 'hourly' ? 'Hourly' : UNKNOWN);
const savedAt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ saved?: string | string[] }> }) {
  const { saved } = await searchParams;
  const jobs = listJobs(appDatabase());
  const savedJob = typeof saved === 'string' ? jobs.find((j) => String(j.id) === saved) : undefined;
  return (
    <main>
      <p>
        <a href="/">← Home</a>
      </p>
      <h1>Saved jobs</h1>
      <p>
        <a href="/jobs/new">Add a job</a>
      </p>
      {savedJob ? <p role="status">Saved “{savedJob.title}”.</p> : null}
      {jobs.length === 0 ? (
        <p>No jobs saved yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {jobs.map((j) => (
            <li key={j.id} id={`job-${j.id}`} style={{ borderTop: '1px solid #ddd', padding: '0.75rem 0' }}>
              <strong>
                <a href={j.url} target="_blank" rel="noreferrer noopener">
                  {j.title}
                </a>
              </strong>
              <div>
                Budget: {show(j.budget)} · Type: {jobType(j.jobType)} · Posted: {show(j.postedAt)} · Connects:{' '}
                {show(j.connectsCost)}
              </div>
              <div>Client: {show(j.client)}</div>
              <div style={{ color: '#666', fontSize: '0.9em' }}>Saved {savedAt(j.createdAt)} Mountain time</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
