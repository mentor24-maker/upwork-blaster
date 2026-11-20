import { jobFormMessage } from '../../../lib/jobs.ts';

const field = { display: 'block', marginBottom: '1rem' } as const;
const input = { display: 'block', width: '100%', maxWidth: '40rem', marginTop: '0.25rem' } as const;

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; existing?: string | string[] }>;
}) {
  const { error, existing } = await searchParams;
  const message = jobFormMessage(error);
  const existingId = typeof existing === 'string' && /^\d+$/.test(existing) ? existing : null;
  return (
    <main>
      <p>
        <a href="/jobs">← Saved jobs</a>
      </p>
      <h1>New job</h1>
      <p>
        Paste a job post you found on Upwork. Leave any other field blank: when you save, the AI reads it out of the
        post’s text, and a field the post does not state is kept as unknown. What you type yourself is never replaced.
      </p>
      {message ? (
        <p role="alert" style={{ color: '#a40000' }}>
          {message}
          {error === 'duplicate' && existingId ? (
            <>
              {' '}
              <a href={`/jobs#job-${existingId}`}>See the saved job.</a>
            </>
          ) : null}
        </p>
      ) : null}
      <form method="post" action="/api/jobs">
        <label style={field}>
          Link to the job on Upwork (required)
          <input style={input} type="url" name="url" required placeholder="https://www.upwork.com/jobs/~..." />
        </label>
        <label style={field}>
          Title (required)
          <input style={input} type="text" name="title" required maxLength={2000} />
        </label>
        <label style={field}>
          The post’s text (required)
          <textarea style={input} name="description" required rows={14} maxLength={50000} />
        </label>
        <label style={field}>
          Budget or rate
          <input style={input} type="text" name="budget" maxLength={2000} placeholder="e.g. $1,500 or $40–60/hr" />
        </label>
        <label style={field}>
          Job type
          <select style={input} name="job_type" defaultValue="">
            <option value="">Not stated</option>
            <option value="fixed">Fixed price</option>
            <option value="hourly">Hourly</option>
          </select>
        </label>
        <label style={field}>
          Posted
          <input style={input} type="text" name="posted_at" maxLength={2000} placeholder="e.g. 2 hours ago" />
        </label>
        <label style={field}>
          About the client
          <textarea
            style={input}
            name="client"
            rows={3}
            maxLength={2000}
            placeholder="What the post shows: payment verified, rating, total spent, location…"
          />
        </label>
        <label style={field}>
          Connects to apply
          <input style={input} type="number" name="connects_cost" min={0} max={9999} step={1} />
        </label>
        <button type="submit">Save job</button>
      </form>
    </main>
  );
}
