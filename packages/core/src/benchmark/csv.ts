import { writeFileSync } from 'node:fs';

export type CsvRow = Record<string, string | number | boolean | null | undefined>;

// Minimal RFC 4180 CSV writer — no deps. Escapes quotes, wraps values with
// commas/quotes/newlines. Header derived from the first row's keys.
export function writeCsv(path: string, rows: CsvRow[]): void {
  if (rows.length === 0) {
    writeFileSync(path, '', 'utf-8');
    return;
  }
  const headers = Object.keys(rows[0] as CsvRow);
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h] ?? '')).join(','));
  }
  writeFileSync(path, lines.join('\n'), 'utf-8');
}

function escapeCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
