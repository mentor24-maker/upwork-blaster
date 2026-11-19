import { readAuthConfig } from '../../lib/session.ts';
import { signInMessage } from '../../lib/sign_in_messages.ts';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  const message = signInMessage(error, readAuthConfig() !== null);
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
