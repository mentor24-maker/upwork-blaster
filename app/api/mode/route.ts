// The Demo/Manual switch posts here (lib/mode.ts). A plain form post: the
// gate (lib/gate.ts) has already refused it unless the browser is signed in.
// Switching only changes which database the app reads; it writes no data.
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
  return redirect('/jobs', 303);
}
