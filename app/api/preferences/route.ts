// The Preferences form posts here. A plain form post, the same as the job and
// sign-in forms: the gate (lib/gate.ts) has already refused it unless the
// browser is signed in, and the tests can call it directly. Each save that
// passes the checks becomes a new version; nothing old is changed.
import { appDatabase } from '../../../lib/app_db.ts';
import { redirect } from '../../../lib/gate.ts';
import { readPreferencesForm, savePreferences } from '../../../lib/preferences.ts';

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect('/preferences?error=bad-weight', 303);
  }
  const read = readPreferencesForm(form);
  if (!read.ok) {
    const total = read.total === undefined ? '' : `&total=${read.total}`;
    return redirect(`/preferences?error=${read.error}${total}`, 303);
  }
  const version = savePreferences(appDatabase(), read.settings);
  return redirect(`/preferences?saved=${version}`, 303);
}
