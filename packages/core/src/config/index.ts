import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import TOML from '@iarna/toml';

export const CONFIG_VERSION = 1;

export type Config = {
  version: number;
  qonto: {
    slug: string;
    organizationName: string;
    // IBANs the user opted in to track at init time. Benchmark, sync, match
    // all pull transactions only from these accounts.
    bankAccountIbans: string[];
  };
  gmail: {
    // The client_id used for the OAuth flow — NOT a secret, kept for traceability.
    clientId: string;
  };
};

export function readConfig(path: string): Config | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  return TOML.parse(raw) as unknown as Config;
}

export function writeConfig(path: string, config: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, TOML.stringify(config as unknown as TOML.JsonMap), 'utf-8');
}
