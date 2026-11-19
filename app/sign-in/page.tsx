import { readAuthConfig } from '../../lib/session.ts';

const MESSAGES: Record<string, string> = {
  wrong: 'That password is not right. Try again.',
  'not-set-up': "The app's password is not set up yet, so nobody can sign in.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = readAuthConfig() ? MESSAGES[error ?? ''] : MESSAGES['not-set-up'];
  return (
    <main>
      <h1>Upwork Blaster</h1>
      <form method="post" action="/api/sign-in">
        <label>
          Password{' '}
          <input type="password" name="password" autoComplete="current-password" required autoFocus />
        </label>{' '}
        <button type="submit">Sign in</button>
      </form>
      {message ? <p role="alert">{message}</p> : null}
    </main>
  );
}
