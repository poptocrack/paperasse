import { normalizeLabel } from './normalize.js';
import synonymsData from './synonyms.json' with { type: 'json' };

const synonyms = synonymsData as Record<string, string[]>;

export const MATCH_THRESHOLD = 0.9;

// Scores how likely a Qonto label refers to the given vendor.
// 1.0 = direct substring match, 0.9 = synonym substring match, 0..0.7 = fuzzy fallback.
export function vendorScore(vendorKey: string, transactionLabel: string): number {
  const normalizedLabel = normalizeLabel(transactionLabel);
  const normalizedVendor = vendorKey.toUpperCase();

  if (normalizedLabel.includes(normalizedVendor)) {
    return 1.0;
  }

  const vendorSynonyms = synonyms[vendorKey.toLowerCase()] ?? [];
  for (const synonym of vendorSynonyms) {
    if (normalizedLabel.includes(synonym.toUpperCase())) {
      return 0.9;
    }
  }

  return fuzzyScore(normalizedVendor, normalizedLabel);
}

// Token-level similarity, capped at 0.7 so an unaccompanied fuzzy hit never
// clears the MATCH_THRESHOLD — keeps V1 conservative until we have real data.
function fuzzyScore(vendor: string, label: string): number {
  const tokens = label.split(' ').filter((t) => t.length >= 3);
  let best = 0;
  for (const token of tokens) {
    const distance = levenshtein(vendor, token);
    const maxLen = Math.max(vendor.length, token.length);
    if (maxLen === 0) continue;
    const similarity = 1 - distance / maxLen;
    if (similarity > best) best = similarity;
  }
  return Math.min(best, 0.7);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = new Uint32Array(rows * cols);
  const idx = (i: number, j: number) => i * cols + j;

  for (let i = 0; i < rows; i++) matrix[idx(i, 0)] = i;
  for (let j = 0; j < cols; j++) matrix[idx(0, j)] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = matrix[idx(i - 1, j)] ?? 0;
      const insertion = matrix[idx(i, j - 1)] ?? 0;
      const substitution = matrix[idx(i - 1, j - 1)] ?? 0;
      matrix[idx(i, j)] = Math.min(deletion + 1, insertion + 1, substitution + cost);
    }
  }

  return matrix[idx(a.length, b.length)] ?? 0;
}
