// Runs before every request (Next.js 16 calls it "proxy", once "middleware"):
// the password check. The decision lives in lib/gate.ts, where the tests reach it.
import { gate } from './lib/gate.ts';

export function proxy(request: Request): Response | undefined {
  return gate(request);
}

export const config = {
  // Every path but the built scripts, styles and images the sign-in page
  // itself needs. They hold no data. Each exclusion is a whole path segment
  // (or the whole favicon path), so /favicon.icoX or /_next/staticX still
  // meet the gate.
  matcher: ['/((?!_next/static/|_next/image$|_next/image/|favicon\\.ico$).*)'],
};
