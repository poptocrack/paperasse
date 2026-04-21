import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Invoice, InvoiceStatus } from '../types.js';
import { SCHEMA_SQL } from './schema.js';

export type Db = Database.Database;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  migrateInvoicesTable(db);
  return db;
}

// Pre-V1 migration: if the invoices table exists but predates the attachment_id
// column, drop it. Safe to do pre-release because no real uploads have happened
// yet — any rows are from local testing and can be re-synced. Once we ship to
// real users we'll replace this with pragma user_version + proper ALTER migrations.
function migrateInvoicesTable(db: Db): void {
  const cols = db.prepare('PRAGMA table_info(invoices)').all() as { name: string }[];
  if (cols.length === 0) return;
  const hasAttachmentId = cols.some((c) => c.name === 'attachment_id');
  if (hasAttachmentId) return;
  db.exec('DROP TABLE IF EXISTS invoices');
  db.exec(SCHEMA_SQL);
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

type InvoiceRow = {
  id: number;
  message_id: string;
  attachment_id: string;
  attachment_filename: string | null;
  vendor: string;
  from_domain: string;
  subject: string | null;
  amount_cents: number;
  currency: string;
  candidate_amounts_cents: string;
  invoice_date: string;
  status: InvoiceStatus;
  qonto_transaction_id: string | null;
  uploaded_at: string | null;
  created_at: string;
};

export type NewInvoice = Omit<Invoice, 'id' | 'createdAt' | 'uploadedAt'>;

// Inserts a new invoice row, or no-ops on duplicate (message_id, attachment_id).
// Returns true when a new row was inserted.
export function upsertInvoice(db: Db, inv: NewInvoice): boolean {
  const res = db
    .prepare(
      `INSERT INTO invoices (
        message_id, attachment_id, attachment_filename, vendor, from_domain,
        subject, amount_cents, currency, candidate_amounts_cents, invoice_date,
        status, qonto_transaction_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id, attachment_id) DO NOTHING`,
    )
    .run(
      inv.messageId,
      inv.attachmentId,
      inv.attachmentFilename,
      inv.vendor,
      inv.fromDomain,
      inv.subject,
      inv.amountCents,
      inv.currency,
      JSON.stringify(inv.candidateAmountsCents),
      inv.invoiceDate,
      inv.status,
      inv.qontoTransactionId,
    );
  return res.changes > 0;
}

export function listInvoicesByStatus(db: Db, status: InvoiceStatus | InvoiceStatus[]): Invoice[] {
  const statuses = Array.isArray(status) ? status : [status];
  const placeholders = statuses.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, message_id, attachment_id, attachment_filename, vendor, from_domain,
              subject, amount_cents, currency, candidate_amounts_cents, invoice_date,
              status, qonto_transaction_id, uploaded_at, created_at
       FROM invoices
       WHERE status IN (${placeholders})
       ORDER BY invoice_date DESC`,
    )
    .all(...statuses) as InvoiceRow[];
  return rows.map(hydrateInvoice);
}

export function markInvoiceUploaded(db: Db, invoiceId: number, qontoTransactionId: string): void {
  db.prepare(
    `UPDATE invoices
     SET status = 'uploaded', qonto_transaction_id = ?, uploaded_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(qontoTransactionId, invoiceId);
}

export function markInvoiceSkipped(db: Db, invoiceId: number): void {
  db.prepare("UPDATE invoices SET status = 'skipped' WHERE id = ?").run(invoiceId);
}

export function markInvoiceError(db: Db, invoiceId: number): void {
  db.prepare("UPDATE invoices SET status = 'error' WHERE id = ?").run(invoiceId);
}

function hydrateInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    messageId: row.message_id,
    attachmentId: row.attachment_id,
    attachmentFilename: row.attachment_filename,
    vendor: row.vendor,
    fromDomain: row.from_domain,
    subject: row.subject,
    amountCents: row.amount_cents,
    currency: row.currency,
    candidateAmountsCents: JSON.parse(row.candidate_amounts_cents) as number[],
    invoiceDate: row.invoice_date,
    status: row.status,
    qontoTransactionId: row.qonto_transaction_id,
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at,
  };
}
