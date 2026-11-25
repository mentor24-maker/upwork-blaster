// The review screen's Approve button posts here (task 3.3, hand-off §13.6).
// It carries the fingerprint of the version the screen showed, so Dane
// approves exactly what he read or nothing at all.
//
// Only Dane's signed-in click approves. The gate (lib/gate.ts) refuses a
// signed-out request before it gets here, and this route checks the sign-in
// again itself, so approval never rests on one check alone. Nothing here
// sends or submits anything.
import { appDatabase } from '../../../lib/app_db.ts';
import { approve, isFingerprint } from '../../../lib/approval.ts';
import { redirect } from '../../../lib/gate.ts';
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
  if (form.get('action') !== 'approve' || typeof fp !== 'string' || !isFingerprint(fp)) {
    return redirect(`${back}?error=bad-form`, 303);
  }
  const result = approve(appDatabase(), Number(p), fp);
  if (result.ok) return redirect(`${back}?done=${result.already ? 'already' : 'approved'}`, 303);
  if (result.reason === 'not-found') return redirect('/inbox?error=not-found', 303);
  return redirect(`${back}?error=${result.reason}`, 303);
}
