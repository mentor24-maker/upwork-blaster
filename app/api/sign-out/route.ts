// The sign-out button posts here: the cookie is cleared and the browser is
// sent back to the sign-in page.
import { redirect } from '../../../lib/gate.ts';
import { sessionCookieHeader } from '../../../lib/session.ts';

export async function POST(): Promise<Response> {
  const response = redirect('/sign-in', 303);
  response.headers.set('Set-Cookie', sessionCookieHeader(null));
  return response;
}
