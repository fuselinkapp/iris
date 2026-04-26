// Bare 'fs' / 'path' (no 'node:' prefix) so the edge bundler's resolve.alias
// can shim them out — the `node:` scheme isn't an alias target for webpack.
// This module is dead code on edge anyway (constructNodeDb is never reached),
// but the bundler still walks the import graph.
// biome-ignore lint/style/useNodejsImportProtocol: see comment above
import { existsSync, readdirSync } from 'fs';
// biome-ignore lint/style/useNodejsImportProtocol: see comment above
import { join, resolve } from 'path';

// Wrangler stores local D1 at:
//   .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
// We have one D1 in this project, so the first .sqlite file in that dir is it.
// CLI scripts (seed, worker:test) call this directly because they run as
// plain tsx and can't go through the `server-only`-marked client.ts.
export function resolveLocalD1Path(): string {
  const dir = resolve(process.cwd(), '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (existsSync(dir)) {
    const candidates = readdirSync(dir).filter((f) => f.endsWith('.sqlite'));
    if (candidates[0]) return join(dir, candidates[0]);
  }
  throw new Error(
    '[iris] No local D1 store found. Run `pnpm db:migrate` first ' +
      '(it shells out to `wrangler d1 migrations apply iris-d1 --local`).',
  );
}
