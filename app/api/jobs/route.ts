// The New Job form posts here. A plain form post, not a server action, the
// same as the sign-in form: the gate (lib/gate.ts) has already refused it
// unless the browser is signed in, and the tests can call it directly.
import { appDatabase } from '../../../lib/app_db.ts';
import { redirect } from '../../../lib/gate.ts';
import { readJobForm, saveJob } from '../../../lib/jobs.ts';
import { fillJobFromPost } from '../../../lib/extractJob.ts';
import { scoreJobAndRecord } from '../../../lib/score.ts';

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect('/jobs/new?error=no-url', 303);
  }
  const read = readJobForm(form);
  if (!read.ok) return redirect(`/jobs/new?error=${read.error}`, 303);

  const db = appDatabase();
  const saved = saveJob(db, read.job);
  if (!saved.ok) return redirect(`/jobs/new?error=duplicate&existing=${saved.existingId}`, 303);
  // The AI fills in the fields he left blank (task 2.4). The job is already
  // saved: if the AI cannot read it, the job page says why and nothing is lost.
  await fillJobFromPost(db, saved.id);
  // Then it is scored with the preferences in force (task 2.5), after the AI
  // so the score sees the fields it filled in.
  // The job is saved either way: a scoring failure must not show a 500 page
  // for a job that was kept (a second submit would then say "duplicate").
  // It is recorded on the job instead, and the jobs page says it is not scored.
  const problem = scoreJobAndRecord(db, saved.id);
  if (problem) console.error(`scoring job ${saved.id} failed: ${problem}`);
  return redirect(`/jobs?saved=${saved.id}`, 303);
}
