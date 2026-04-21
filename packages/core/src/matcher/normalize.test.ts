import { describe, expect, it } from 'vitest';
import { normalizeLabel } from './normalize.js';

describe('normalizeLabel', () => {
  it('uppercases and strips accents', () => {
    expect(normalizeLabel('Café Société')).toBe('CAFE SOCIETE');
  });

  it('removes CB/VIR/PRLV bank prefixes', () => {
    expect(normalizeLabel('CB STRIPE PAYMENTS')).toBe('STRIPE PAYMENTS');
    expect(normalizeLabel('VIR SEPA OPENAI LLC')).toBe('OPENAI LLC');
    expect(normalizeLabel('PRLV OVH CLOUD')).toBe('OVH CLOUD');
  });

  it('strips long digit runs (card / account numbers)', () => {
    expect(normalizeLabel('STRIPE 5432123456781234')).toBe('STRIPE');
  });

  it('collapses whitespace', () => {
    expect(normalizeLabel('  GITHUB    INC  ')).toBe('GITHUB INC');
  });
});
