import type { QontoTransaction } from '../types.js';

export type CandidateEmail = {
  messageId: string;
  date: string;
  fromDomain: string;
  subject: string;
  candidateAmountsCents: number[];
};

export type TxClassification = 'matched_single' | 'matched_ambiguous' | 'no_candidate_email';

export type TxBenchmarkRow = {
  transactionId: string;
  settledAt: string;
  amountCents: number;
  localAmountCents: number;
  localCurrency: string;
  label: string;
  operationType: string;
  candidateEmailIds: string[];
  classification: TxClassification;
};

export type ClassifyTxParams = {
  transaction: QontoTransaction;
  emails: CandidateEmail[];
  daysBefore: number;
  daysAfter: number;
};

// For a given Qonto transaction that's missing its justificatif, finds the
// Gmail messages in a ±window around settled_at whose extracted amounts (EUR
// or USD) match the transaction's amount or localAmount.
export function classifyTransaction(params: ClassifyTxParams): {
  classification: TxClassification;
  matches: CandidateEmail[];
} {
  const windowStart = shiftDate(params.transaction.settledAt, -params.daysBefore);
  const windowEnd = shiftDate(params.transaction.settledAt, params.daysAfter);

  const matches = params.emails.filter((e) => {
    if (e.date < windowStart || e.date > windowEnd) return false;
    if (e.candidateAmountsCents.length === 0) return false;
    return (
      e.candidateAmountsCents.includes(params.transaction.amountCents) ||
      e.candidateAmountsCents.includes(params.transaction.localAmountCents)
    );
  });

  if (matches.length === 0) return { classification: 'no_candidate_email', matches: [] };
  if (matches.length === 1) return { classification: 'matched_single', matches };
  return { classification: 'matched_ambiguous', matches };
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
