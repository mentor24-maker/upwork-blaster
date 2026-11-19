import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The app lives at the root of the repository, beside the loop's own
  // scripts; say so, so Next.js never guesses a parent folder as the root.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
