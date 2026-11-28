// The "Reload demo data" button on the Demo banner posts here (lib/demo.ts).
// The gate (lib/gate.ts) has already refused it unless the browser is signed
// in. It only ever touches the demo database: outside Demo mode it does
// nothing, and the loader itself refuses any other file.
import { appDatabase } from '../../../lib/app_db.ts';
import { runDemoLoad } from '../../../lib/demo.ts';
import { redirect } from '../../../lib/gate.ts';
import { currentMode } from '../../../lib/mode.ts';

export async function POST(): Promise<Response> {
  if (currentMode() !== 'demo') return redirect('/jobs', 303);
  return redirect(`/jobs?demo=${runDemoLoad(() => appDatabase(), true)}`, 303);
}
