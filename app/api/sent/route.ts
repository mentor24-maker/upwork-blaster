// The review screen's "I sent it" button posts here (task 3.4, hand-off
// §13.11). It records Dane's word that he copied the approved version into
// Upwork himself and sent it there. Nothing here sends or submits anything:
// the app has no connection to Upwork.
//
// Only Dane's signed-in click marks a proposal sent. The gate (lib/gate.ts)
// refuses a signed-out request before it gets here, and this route checks
// the sign-in again itself. The click carries the fingerprint of the version
// the screen showed, so the mark lands on the version he copied or not at all.
import { isFingerprint } from '../../../lib/approval.ts';
import { appDatabase } from '../../../lib/app_db.ts';
import { redirect } from '../../../lib/gate.ts';
import { markSent } from '../../../lib/sent.ts';
import { isSignedIn } from '../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  if (!isSignedIn(request)) return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect('/inbox?error=bad-decision', 303);
  }
  const p = form.get('proposal');
  const fp = form.get('fingerprint');
  if (typeof p !== 'string' || !/^\d{1,12}$/.test(p)) return redirect('/inbox?error=bad-decision', 303);
  const back = `/proposals/${p}/review`;
  if (form.get('action') !== 'sent' || typeof fp !== 'string' || !isFingerprint(fp)) {
    return redirect(`${back}?error=bad-form`, 303);
  }
  const result = markSent(appDatabase(), Number(p), fp);
  if (result.ok) return redirect(`${back}?done=${result.already ? 'already-sent' : 'sent'}`, 303);
  if (result.reason === 'not-found') return redirect('/inbox?error=not-found', 303);
  return redirect(`${back}?error=${result.reason === 'changed' ? 'changed-sent' : 'not-approved'}`, 303);
}
