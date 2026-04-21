export type InvoiceStatus = 'pending' | 'matched' | 'uploaded' | 'skipped' | 'error';

export type Invoice = {
  id: number;
  messageId: string;
  // Gmail attachment ID — used to re-fetch the PDF at upload time so we never
  // persist the bytes locally.
  attachmentId: string;
  attachmentFilename: string | null;
  vendor: string;
  fromDomain: string;
  subject: string | null;
  amountCents: number;
  currency: string;
  // All candidate amounts extracted from body/PDF — the matcher tries each
  // against Qonto transactions.
  candidateAmountsCents: number[];
  invoiceDate: string;
  status: InvoiceStatus;
  qontoTransactionId: string | null;
  uploadedAt: string | null;
  createdAt: string;
};

export type QontoTransaction = {
  id: string;
  amountCents: number;
  currency: string;
  // Amount in the original currency of the operation (e.g. a $20 USD card
  // charge settles as €18.37 — amountCents=1837, localAmountCents=2000,
  // localCurrency='USD'). Equal to amountCents when no FX happened.
  localAmountCents: number;
  localCurrency: string;
  settledAt: string;
  label: string;
  rawLabel: string;
  // IDs of justificatifs already attached on Qonto. Empty => still needs one.
  attachmentIds: string[];
  // card, direct_debit, transfer, swift_income, qonto_fee, ...
  operationType: string;
};

export type MatchCandidate = {
  transaction: QontoTransaction;
  vendorScore: number;
};

export type MatchResult =
  | { kind: 'single'; candidate: MatchCandidate }
  | { kind: 'tie'; candidates: MatchCandidate[] }
  | { kind: 'none' };
