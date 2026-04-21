export type InvoiceStatus = 'pending' | 'matched' | 'uploaded' | 'skipped' | 'error';

export type Invoice = {
  id: number;
  messageId: string;
  attachmentHash: string;
  vendor: string;
  amountCents: number;
  currency: string;
  invoiceDate: string;
  pdfLocalPath: string;
  status: InvoiceStatus;
  qontoTransactionId: string | null;
  createdAt: string;
};

export type QontoTransaction = {
  id: string;
  amountCents: number;
  currency: string;
  settledAt: string;
  label: string;
  rawLabel: string;
};

export type MatchCandidate = {
  transaction: QontoTransaction;
  vendorScore: number;
};

export type MatchResult =
  | { kind: 'single'; candidate: MatchCandidate }
  | { kind: 'tie'; candidates: MatchCandidate[] }
  | { kind: 'none' };
