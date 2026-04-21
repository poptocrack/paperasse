import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

// Replaced at build time by tsup `define`. Empty strings in dev — the
// .env walk-up below populates process.env for the dev case.
declare const __PAPERASSE_GOOGLE_CLIENT_ID__: string;
declare const __PAPERASSE_GOOGLE_CLIENT_SECRET__: string;

// In dev we load .env so Google OAuth creds are available. We walk up from cwd
// looking for the first .env, which covers both "run from repo root" and
// "run from packages/cli" (pnpm --filter sets cwd to the package). When the
// CLI is installed via npm the creds are already inlined via tsup `define`
// and no .env is present — we skip silently.
export function loadDevEnv(): void {
  const envFile = findUpwards('.env', process.cwd());
  if (envFile) {
    process.loadEnvFile(envFile);
  }
}

// Returns the Google OAuth client credentials. Prefers the build-time inlined
// values (production npm install) and falls back to runtime env vars (dev).
export function getGoogleCreds(): { clientId: string; clientSecret: string } {
  const clientId =
    (typeof __PAPERASSE_GOOGLE_CLIENT_ID__ === 'string' && __PAPERASSE_GOOGLE_CLIENT_ID__) ||
    process.env.PAPERASSE_GOOGLE_CLIENT_ID ||
    '';
  const clientSecret =
    (typeof __PAPERASSE_GOOGLE_CLIENT_SECRET__ === 'string' &&
      __PAPERASSE_GOOGLE_CLIENT_SECRET__) ||
    process.env.PAPERASSE_GOOGLE_CLIENT_SECRET ||
    '';
  return { clientId, clientSecret };
}

function findUpwards(filename: string, startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = resolve(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
