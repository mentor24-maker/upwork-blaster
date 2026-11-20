import { appDatabase } from '../lib/app_db.ts';
import { aiSpendSummary, spendLine } from '../lib/ai/usage.ts';

// Read on every visit, never baked in when the app is built: the AI spend
// total changes with each saved job.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  const spend = aiSpendSummary(appDatabase());
  return (
    <main>
      <h1>Upwork Blaster</h1>
      <ul>
        <li>
          <a href="/jobs">Saved jobs</a>
        </li>
        <li>
          <a href="/jobs/new">Add a job</a>
        </li>
        <li>
          <a href="/preferences">Preferences</a>
        </li>
        <li>
          <a href="/portfolio">Portfolio</a>
        </li>
      </ul>
      <p id="ai-spend">{spendLine(spend)}</p>
    </main>
  );
}
