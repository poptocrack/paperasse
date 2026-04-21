import { describe, expect, it } from 'vitest';
import { MATCH_THRESHOLD, vendorScore } from './score.js';

describe('vendorScore', () => {
  it('returns 1.0 when vendor appears directly in label', () => {
    expect(vendorScore('stripe', 'CB STRIPE PAYMENTS 1234')).toBe(1.0);
  });

  it('returns 0.9 when a known synonym appears', () => {
    expect(vendorScore('aws', 'VIR SEPA AMAZON WEB SERVICES')).toBe(0.9);
  });

  it('returns a capped fuzzy score when neither hits', () => {
    const score = vendorScore('stripe', 'STRYPE PAYMENTS LLC');
    expect(score).toBeLessThan(MATCH_THRESHOLD);
    expect(score).toBeLessThanOrEqual(0.7);
  });

  it('returns 0 for clearly unrelated labels', () => {
    expect(vendorScore('stripe', 'CARREFOUR MARKET')).toBeLessThan(0.3);
  });
});
