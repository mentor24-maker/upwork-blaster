// The sign-in form posts here. A plain form post, not a server action, so
// the gate can refuse every server action from a signed-out visitor.
import { logActivityOpening } from '../../../lib/activity.ts';
import { appDatabase } from '../../../lib/app_db.ts';
import { redirect } from '../../../lib/gate.ts';
import { createSessionToken, passwordMatches, readAuthConfig, sessionCookieHeader } from '../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  const config = readAuthConfig();
  if (!config) return redirect('/sign-in?error=not-set-up', 303);

  let given = '';
  try {
    const value = (await request.formData()).get('password');
    given = typeof value === 'string' ? value : '';
  } catch {
    given = '';
  }
  if (!passwordMatches(given, config.password)) {
    // The wording is fixed: never the password typed, never the cookie.
    logActivityOpening(appDatabase, { actor: 'app', kind: 'sign-in-refused', summary: 'A sign-in with the wrong password was refused.' });
    return redirect('/sign-in?error=wrong', 303);
  }

  logActivityOpening(appDatabase, { actor: 'Dane', kind: 'signed-in', summary: 'You signed in.' });
  const response = redirect('/', 303);
  response.headers.set('Set-Cookie', sessionCookieHeader(createSessionToken(config)));
  return response;
}

