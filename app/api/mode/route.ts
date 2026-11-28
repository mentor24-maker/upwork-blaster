// The Demo/Manual switch posts here (lib/mode.ts). A plain form post: the
// gate (lib/gate.ts) has already refused it unless the browser is signed in.
// Switching changes which database the app reads. Switching to Demo also
// fills the demo database with the made-up data (lib/demo.ts), adding
// nothing that is already there; the real database is never written.
import { appDatabase } from '../../../lib/app_db.ts';
import { runDemoLoad } from '../../../lib/demo.ts';
import { redirect } from '../../../lib/gate.ts';
import { readMode, setMode } from '../../../lib/mode.ts';

export async function POST(request: Request): Promise<Response> {
  let mode = null;
  try {
    mode = readMode((await request.formData()).get('mode'));
  } catch {
    mode = null;
  }
  if (!mode) return redirect('/jobs?error=bad-mode', 303);
  setMode(mode);
  if (mode === 'demo') return redirect(`/jobs?demo=${runDemoLoad(() => appDatabase(), false)}`, 303);
  return redirect('/jobs', 303);
}
