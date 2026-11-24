// The Inbox cards' Pursue, Pass and Revisit buttons post here. A plain form
// post, the same as the other forms: the gate (lib/gate.ts) has already
// refused it unless the browser is signed in, and the tests can call it
// directly. It writes one decision row and nothing else: never his
// preferences, never a score.
import { appDatabase } from '../../../lib/app_db.ts';
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
  const saved = recordDecision(appDatabase(), read.opportunityId, read.decision, read.reason);
  if (!saved) return redirect('/inbox?error=not-found', 303);
  return redirect(`/inbox?decided=${saved.id}`, 303);
}
