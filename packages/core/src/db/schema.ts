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
  source TEXT NOT NULL DEFAULT 'gmail',
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  attachment_filename TEXT,
  vendor TEXT NOT NULL,
  from_domain TEXT NOT NULL,
  subject TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  candidate_amounts_cents TEXT NOT NULL DEFAULT '[]',
  invoice_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  qonto_transaction_id TEXT,
  uploaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, attachment_id)
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

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  invoice_id INTEGER,
  qonto_transaction_id TEXT,
  amount_cents INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
`;
