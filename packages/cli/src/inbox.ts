import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { benchmark, db, vendors } from '@paperasse/core';
import type { Db } from '@paperasse/core/db';
import { PDFParse } from 'pdf-parse';

export type IngestResult = {
  added: number;
  skipped: number;
  errors: number;
};

// Scans the user's drop-folder for PDFs the user (or an agent, or a script)
// has placed there, parses each one, and registers them as invoices with
// source='inbox'. Dedup is by filename — re-dropping the same file is a no-op.
// The bytes stay on disk until `match` uploads them, then the file is deleted.
export async function ingestInbox(database: Db, inboxDir: string): Promise<IngestResult> {
  const out: IngestResult = { added: 0, skipped: 0, errors: 0 };

  let entries: string[];
  try {
    entries = await readdir(inboxDir);
  } catch {
    return out; // dir doesn't exist yet — nothing to ingest
  }

  for (const name of entries) {
    if (extname(name).toLowerCase() !== '.pdf') {
      out.skipped += 1;
      continue;
    }
    try {
      const full = join(inboxDir, name);
      const bytes = await readFile(full);
      let text = '';
      try {
        const pdf = new PDFParse({ data: new Uint8Array(bytes) });
        const res = await pdf.getText();
        text = res.text ?? '';
        await pdf.destroy();
      } catch {
        // Unreadable PDF — still index it, just with zero amounts so it'll
        // show up as unmatchable in `match` rather than silently ignored.
      }
      const amounts = benchmark.extractCandidateAmountsCents('', text);
      if (amounts.length === 0) {
        out.skipped += 1;
        continue;
      }

      const st = await stat(full);
      const invoiceDate = st.mtime.toISOString().slice(0, 10);
      const base = basename(name, '.pdf');
      const hint = vendors.lookupVendor(base);

      const inserted = db.upsertInvoice(database, {
        source: 'inbox',
        // We key dedup on (message_id='inbox', attachment_id=filename) so
        // re-dropping the same file is a no-op.
        messageId: 'inbox',
        attachmentId: name,
        attachmentFilename: name,
        vendor: hint?.key ?? base.toLowerCase(),
        fromDomain: '',
        subject: null,
        amountCents: amounts[0] ?? 0,
        currency: 'EUR',
        candidateAmountsCents: amounts,
        invoiceDate,
        status: 'pending',
        qontoTransactionId: null,
      });
      if (inserted) out.added += 1;
      else out.skipped += 1;
    } catch {
      out.errors += 1;
    }
  }
  return out;
}
