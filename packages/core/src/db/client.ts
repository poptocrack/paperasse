import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export type Db = Database.Database;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

export type StoredToken = {
  provider: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
};

type TokenRow = {
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

export function upsertToken(db: Db, token: StoredToken): void {
  db.prepare(
    `INSERT INTO tokens (provider, access_token, refresh_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(provider) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(token.provider, token.accessToken, token.refreshToken, token.expiresAt);
}

export function getToken(db: Db, provider: string): StoredToken | null {
  const row = db
    .prepare(
      'SELECT provider, access_token, refresh_token, expires_at FROM tokens WHERE provider = ?',
    )
    .get(provider) as TokenRow | undefined;
  if (!row) return null;
  return {
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}
