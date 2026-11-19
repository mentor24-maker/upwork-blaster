/**
 * What a request may reach, decided before any page or server action runs
 * (proxy.ts calls this on every request but the built page assets).
 *
 * A signed-out visitor may only open the sign-in page and send its form.
 * Everything else gets nothing: a page visit is sent to the sign-in page
 * with an empty body, and anything else (a server action, a form post, an
 * API call) gets an empty 401. A server action is refused on every path,
 * the sign-in page's included, because Next.js runs an action by its id
 * whatever path it is posted to.
 */

import { isSignedIn } from './session.ts';

type Env = Record<string, string | undefined>;

export const SIGN_IN_PATH = '/sign-in';
export const SIGN_IN_ACTION = '/api/sign-in';

/** A response, or undefined to let the request through. */
export function gate(request: Request, env: Env = process.env, now: number = Date.now()): Response | undefined {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();
  const isPageVisit = method === 'GET' || method === 'HEAD';
  const isServerAction = request.headers.has('next-action');

  if (isSignedIn(request, env, now)) {
    // Already in: the sign-in page has nothing to offer.
    if (pathname === SIGN_IN_PATH && isPageVisit && !isServerAction) return redirect(new URL('/', request.url));
    return undefined;
  }

  if (!isServerAction) {
    if (pathname === SIGN_IN_PATH && isPageVisit) return undefined;
    if (pathname === SIGN_IN_ACTION && method === 'POST') return undefined;
  }
  if (isPageVisit && !isServerAction) return redirect(new URL(SIGN_IN_PATH, request.url));
  return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * An empty redirect. The proxy needs a full address (Next.js rejects a bare
 * path there), built from the request's own, so the browser stays on whatever
 * address it used; a route handler may send a bare path, which the browser
 * resolves the same way (the server listens on every address of the Mini, so
 * it cannot know which one a device used).
 */
export function redirect(location: string | URL, status = 307): Response {
  return new Response(null, { status, headers: { Location: String(location), 'Cache-Control': 'no-store' } });
}
