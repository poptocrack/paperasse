import { describe, expect, it } from 'vitest';
import type { QontoTransaction } from '../types.js';
import { matchInvoice } from './match.js';

const tx = (overrides: Partial<QontoTransaction>): QontoTransaction => ({
  id: 't-1',
  amountCents: 4200,
  currency: 'EUR',
  settledAt: '2026-04-15',
  label: 'CB STRIPE PAYMENTS',
  rawLabel: 'CB STRIPE PAYMENTS',
  ...overrides,
});

describe('matchInvoice', () => {
  it('returns a single match when exactly one transaction fits', () => {
    const result = matchInvoice(
      { vendor: 'stripe', amountCents: 4200, currency: 'EUR', invoiceDate: '2026-04-14' },
      [tx({})],
    );
    expect(result.kind).toBe('single');
  });

  it('rejects amount mismatches (no cent tolerance)', () => {
    const result = matchInvoice(
      { vendor: 'stripe', amountCents: 4200, currency: 'EUR', invoiceDate: '2026-04-14' },
      [tx({ amountCents: 4201 })],
    );
    expect(result.kind).toBe('none');
  });

  it('rejects transactions outside the date window', () => {
    const result = matchInvoice(
      { vendor: 'stripe', amountCents: 4200, currency: 'EUR', invoiceDate: '2026-04-14' },
      [tx({ settledAt: '2026-04-25' })],
    );
    expect(result.kind).toBe('none');
  });

  it('returns a tie when multiple candidates clear the threshold', () => {
    const result = matchInvoice(
      { vendor: 'stripe', amountCents: 4200, currency: 'EUR', invoiceDate: '2026-04-14' },
      [tx({ id: 'a' }), tx({ id: 'b', settledAt: '2026-04-16' })],
    );
    expect(result.kind).toBe('tie');
  });
});
