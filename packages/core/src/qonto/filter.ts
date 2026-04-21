import type { QontoTransaction } from '../types.js';

// Debits that should never be part of the matching flow — they never have
// an email invoice to attach. Self-transfers (founder's own accounts),
// URSSAF direct debits (social charges, billed via net-entreprises portal),
// and Qonto's own fees.
export function isExcludedFromMatch(t: QontoTransaction): boolean {
  if (t.operationType === 'qonto_fee') return true;
  const label = `${t.label} ${t.rawLabel}`.toUpperCase();
  if (t.operationType === 'transfer' && /\b(VIR(EMENT)? INTERNE|DEBROISE)\b/.test(label))
    return true;
  if (/\bURSSAF\b/.test(label)) return true;
  return false;
}
