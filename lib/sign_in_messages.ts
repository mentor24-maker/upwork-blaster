/**
 * The one line the sign-in page shows under the form, picked from the
 * `?error=` in its address. Only the page's own names count: anything else
 * (including names every object inherits, like `__proto__` or
 * `constructor`) shows nothing, so a made-up address cannot break the page.
 */

const MESSAGES = new Map<string, string>([
  ['wrong', 'That password is not right. Try again.'],
  ['not-set-up', "The app's password is not set up yet, so nobody can sign in."],
]);

export function signInMessage(error: string | string[] | undefined, configured: boolean): string | undefined {
  if (!configured) return MESSAGES.get('not-set-up');
  return typeof error === 'string' ? MESSAGES.get(error) : undefined;
}
