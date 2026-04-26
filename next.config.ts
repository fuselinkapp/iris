import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  webpack: (cfg, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      // Excludes Node-only modules from edge bundles. The runtime branch in
      // lib/db/client.ts won't reach these on edge, but the bundler still
      // needs them aliased away or it'll try to resolve them. The `node:`
      // URI scheme isn't an alias target for webpack, so local-path.ts
      // imports the bare specifiers (`fs`, `path`) for this to work.
      cfg.resolve = cfg.resolve ?? {};
      cfg.resolve.alias = {
        ...((cfg.resolve.alias as Record<string, unknown> | undefined) ?? {}),
        'better-sqlite3': false,
        'drizzle-orm/better-sqlite3': false,
        fs: false,
        path: false,
      };
    }
    return cfg;
  },
};

// Async config form so setupDevPlatform() actually completes before Next
// starts handling requests. Fire-and-forget would race the first request.
export default (async (): Promise<NextConfig> => {
  if (process.env.NODE_ENV === 'development') {
    const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev');
    await setupDevPlatform();
  }
  return config;
})();
