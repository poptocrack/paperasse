import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

// In dev we load .env so Google OAuth creds are available. We walk up from cwd
// looking for the first .env, which covers both "run from repo root" and
// "run from packages/cli" (pnpm --filter sets cwd to the package). When the
// CLI is installed via npm the creds will be inlined into the bundle at
// publish time and no .env is present — we skip silently.
export function loadDevEnv(): void {
  const envFile = findUpwards('.env', process.cwd());
  if (envFile) {
    process.loadEnvFile(envFile);
  }
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
