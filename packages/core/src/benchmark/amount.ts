// Extracts plausible currency amounts (as integer cents) from an email body
// and/or PDF text. Captures both EUR and USD — many SaaS bill in USD (Anthropic,
// OpenAI, Stripe, AWS, Vercel). Qonto exposes local_amount_cents + local_currency
// so downstream matching can compare USD PDF amounts to the USD local amount of
// the card transaction directly, no FX conversion needed.
//
// Optimized for recall over precision: benchmark classifies as "matched" when
// ANY extracted amount matches ANY Qonto amount (in either currency), so we'd
// rather over-generate candidates than miss the real total.

const CURRENCY_PATTERNS = [
  // EUR
  /€\s*([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)/gi,
  /([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)\s*€/gi,
  /([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)\s*EUR\b/gi,
  /EUR\s*([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)/gi,
  // USD
  /\$\s*([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)/g,
  /([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)\s*\$/g,
  /([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)\s*USD\b/gi,
  /USD\s*([0-9]+(?:[.,   ][0-9]{3})*(?:[.,][0-9]{1,2})?)/gi,
];

export function extractCandidateAmountsCents(bodyText: string, bodyHtml: string): number[] {
  const text = `${stripHtml(bodyHtml)}\n${bodyText}`;
  const cents = new Set<number>();

  for (const pattern of CURRENCY_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (!raw) continue;
      const parsed = parseCurrencyNumber(raw);
      if (parsed === null) continue;
      const c = Math.round(parsed * 100);
      if (c > 0 && c < 10_000_00) cents.add(c);
    }
  }

  return [...cents].sort((a, b) => b - a);
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&#8364;/g, '€')
    .replace(/&dollar;/gi, '$')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function parseCurrencyNumber(raw: string): number | null {
  // Normalize thousands/decimal separators. Common forms:
  //   "1.234,56" (FR/DE), "1,234.56" (EN), "1 234,56" (FR with NBSP).
  const cleaned = raw.replace(/[   ]/g, '');
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  let normalized: string;
  if (hasComma && hasDot) {
    // Whichever separator appears last is the decimal.
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Comma is decimal only if followed by 1-2 digits AND appears once.
    const parts = cleaned.split(',');
    const last = parts[parts.length - 1];
    if (last !== undefined && last.length <= 2 && parts.length === 2) {
      normalized = cleaned.replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else {
    normalized = cleaned;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
