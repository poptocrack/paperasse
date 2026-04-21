import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'tsup';

// Load creds from the repo-root .env so `pnpm build` works without the user
// having to export env vars in their shell. In CI this is replaced by
// secrets injected into the process env before build.
loadEnv({ path: resolve(import.meta.dirname, '../../.env') });

const clientId = process.env.PAPERASSE_GOOGLE_CLIENT_ID ?? '';
const clientSecret = process.env.PAPERASSE_GOOGLE_CLIENT_SECRET ?? '';

if (process.env.NODE_ENV === 'production' && (!clientId || !clientSecret)) {
  throw new Error(
    'Build requires PAPERASSE_GOOGLE_CLIENT_ID and PAPERASSE_GOOGLE_CLIENT_SECRET in env.',
  );
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  dts: false,
  banner: { js: '#!/usr/bin/env node' },
  // Bundle the workspace core in — it's never published to npm.
  noExternal: [/^@paperasse\//],
  define: {
    __PAPERASSE_GOOGLE_CLIENT_ID__: JSON.stringify(clientId),
    __PAPERASSE_GOOGLE_CLIENT_SECRET__: JSON.stringify(clientSecret),
  },
});
