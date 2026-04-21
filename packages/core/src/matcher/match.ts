import type { Invoice, MatchCandidate, MatchResult, QontoTransaction } from '../types.js';
import { MATCH_THRESHOLD, vendorScore } from './score.js';

const DAYS_BEFORE = 2;
const DAYS_AFTER = 5;

export function matchInvoice(
  invoice: Pick<Invoice, 'vendor' | 'amountCents' | 'currency' | 'invoiceDate'>,
  transactions: QontoTransaction[],
): MatchResult {
  const dateWindowStart = shiftDate(invoice.invoiceDate, -DAYS_BEFORE);
  const dateWindowEnd = shiftDate(invoice.invoiceDate, DAYS_AFTER);

  const candidates: MatchCandidate[] = [];
  for (const transaction of transactions) {
    if (transaction.amountCents !== invoice.amountCents) continue;
    if (transaction.currency !== invoice.currency) continue;
    if (transaction.settledAt < dateWindowStart) continue;
    if (transaction.settledAt > dateWindowEnd) continue;

    const score = vendorScore(invoice.vendor, transaction.rawLabel);
    if (score >= MATCH_THRESHOLD) {
      candidates.push({ transaction, vendorScore: score });
    }
  }

  const [first] = candidates;
  if (!first) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'single', candidate: first };
  return { kind: 'tie', candidates };
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
