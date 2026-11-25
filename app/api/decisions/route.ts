// The Inbox cards' Pursue, Pass and Revisit buttons post here. A plain form
// post, the same as the other forms: the gate (lib/gate.ts) has already
// refused it unless the browser is signed in, and the tests can call it
// directly. It writes one decision row, never his preferences, never a score.
// Pursue then opens the job's proposal workspace with a first draft (task
// 3.1, lib/draft.ts): a draft only, nothing is sent anywhere.
import { appDatabase } from '../../../lib/app_db.ts';
import { openProposal } from '../../../lib/draft.ts';
import { redirect } from '../../../lib/gate.ts';
import { readDecisionForm, recordDecision } from '../../../lib/inbox.ts';

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect('/inbox?error=bad-decision', 303);
  }
  const read = readDecisionForm(form);
  if (!read) return redirect('/inbox?error=bad-decision', 303);
  const db = appDatabase();
  const saved = recordDecision(db, read.opportunityId, read.decision, read.reason);
  if (!saved) return redirect('/inbox?error=not-found', 303);
  if (saved.decision !== 'pursue') return redirect(`/inbox?decided=${saved.id}`, 303);

  // The decision is kept either way. A failed AI call is recorded on the
  // proposal and shown on its page; only a failure to save it lands here.
  try {
    const proposal = await openProposal(db, saved.opportunityId);
    if (proposal) return redirect(`/proposals/${proposal.id}`, 303);
  } catch (err) {
    console.error(`opening the proposal for job ${saved.opportunityId} failed: ${(err as Error).message}`);
  }
  return redirect(`/inbox?decided=${saved.id}&error=no-workspace`, 303);
}
