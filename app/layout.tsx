import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { isValidSessionToken, readAuthConfig, SESSION_COOKIE } from '../lib/session.ts';

export const metadata: Metadata = {
  title: 'Upwork Blaster',
  description: 'A private helper for answering Upwork jobs, run on the Mini.',
};

// Reads the cookie first, always: that is what makes every page render per
// visit rather than once at build time, when no browser and no keys exist.
async function signedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const config = readAuthConfig();
  return config ? isValidSessionToken(token, config.secret) : false;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem' }}>
        {(await signedIn()) ? (
          <form method="post" action="/api/sign-out" style={{ float: 'right' }}>
            <button type="submit">Sign out</button>
          </form>
        ) : null}
        {children}
      </body>
    </html>
  );
}
