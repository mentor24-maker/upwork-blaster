// The proposal workspace's forms post here (task 3.1): an answer to a
// screening question, a question added by hand, or "try the draft again".
// The gate (lib/gate.ts) has already refused it unless the browser is signed
// in. Nothing here approves, sends or submits anything.
import { appDatabase } from '../../../lib/app_db.ts';
import { addQuestion, answerQuestion, getProposal, readWorkspaceForm, writeDraft } from '../../../lib/draft.ts';
import { redirect } from '../../../lib/gate.ts';

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect('/inbox?error=bad-decision', 303);
  }
  const action = readWorkspaceForm(form);
  if (!action) {
    const p = form.get('proposal');
    return typeof p === 'string' && /^\d{1,12}$/.test(p)
      ? redirect(`/proposals/${p}?error=bad-form`, 303)
      : redirect('/inbox?error=bad-decision', 303);
  }
  const db = appDatabase();
  const back = `/proposals/${action.proposalId}`;
  if (!getProposal(db, action.proposalId)) return redirect('/inbox?error=not-found', 303);

  if (action.kind === 'answer') {
    const ok = answerQuestion(db, action.proposalId, action.questionId, action.answer);
    return redirect(ok ? `${back}?saved=answer#q-${action.questionId}` : `${back}?error=bad-form`, 303);
  }
  if (action.kind === 'add-question') {
    const ok = addQuestion(db, action.proposalId, action.question);
    return redirect(ok ? `${back}?saved=question#questions` : `${back}?error=too-many`, 303);
  }
  await writeDraft(db, action.proposalId);
  return redirect(back, 303);
}
