// The New Job form posts here. A plain form post, not a server action, the
// same as the sign-in form: the gate (lib/gate.ts) has already refused it
// unless the browser is signed in, and the tests can call it directly.
import { appDatabase } from '../../../lib/app_db.ts';
import { redirect } from '../../../lib/gate.ts';
import { readJobForm, saveJob } from '../../../lib/jobs.ts';
import { fillJobFromPost } from '../../../lib/extractJob.ts';

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
  return redirect(`/jobs?saved=${saved.id}`, 303);
}
