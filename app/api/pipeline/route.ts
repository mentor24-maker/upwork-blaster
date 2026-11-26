// The Pipeline board's forms post here (task 3.5): move a sent job to a
// status, add a note, or set its next action. Every value is one Dane set;
// nothing here talks to Upwork or guesses a status.
//
// Only his signed-in click changes the board. The gate (lib/gate.ts) refuses
// a signed-out request before it gets here, and this route checks the
// sign-in again itself.
import { appDatabase } from '../../../lib/app_db.ts';
import { redirect } from '../../../lib/gate.ts';
import { applyPipelineAction, readPipelineForm } from '../../../lib/pipeline.ts';
import { isSignedIn } from '../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  if (!isSignedIn(request)) return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect('/pipeline?error=bad-form', 303);
  }
  const action = readPipelineForm(form);
  if (!action) return redirect('/pipeline?error=bad-form', 303);
  const result = applyPipelineAction(appDatabase(), action);
  // The message shows inside the job's own card (the page reads `job`), and
  // the anchor scrolls to it, so he sees what happened where he clicked.
  const here = `&job=${action.proposalId}#job-${action.proposalId}`;
  if (!result.ok) return redirect(`/pipeline?error=${result.reason}${result.reason === 'empty' ? here : ''}`, 303);
  const done = result.already
    ? 'already'
    : action.action === 'move'
      ? 'moved'
      : action.action === 'note'
        ? 'noted'
        : result.card.nextAction === null
          ? 'cleared'
          : 'next';
  return redirect(`/pipeline?done=${done}${here}`, 303);
}
