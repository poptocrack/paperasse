export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS emails (
  message_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT,
  processed_at TEXT,
  is_invoice INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES emails(message_id),
  attachment_hash TEXT NOT NULL,
  vendor TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  invoice_date TEXT NOT NULL,
  pdf_local_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  qonto_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, attachment_hash)
);

CREATE TABLE IF NOT EXISTS tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
`;
