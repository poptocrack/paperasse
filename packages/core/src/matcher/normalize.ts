const BANK_PREFIXES = /^(VIR SEPA |REMISE CHQ |PRLV |VIR |CB |TPE )/;
const LONG_DIGITS = /\d{4,}/g;
const SIREN_SIRET = /\b\d{9}(\d{5})?\b/g;
const WHITESPACE = /\s+/g;

// Normalizes a Qonto transaction label so we can substring-match a vendor name against it.
// Strips accents, bank prefixes, card/account numbers, SIREN/SIRET.
export function normalizeLabel(label: string): string {
  return label
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(BANK_PREFIXES, '')
    .replace(LONG_DIGITS, '')
    .replace(SIREN_SIRET, '')
    .replace(WHITESPACE, ' ')
    .trim();
}
