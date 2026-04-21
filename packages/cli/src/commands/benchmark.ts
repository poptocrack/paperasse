import process from 'node:process';
import { benchmark, config, db, gmail, qonto } from '@paperasse/core';
import type { CandidateEmail, TxBenchmarkRow, TxClassification } from '@paperasse/core/benchmark';
import chalk from 'chalk';
import ora from 'ora';
import { PDFParse } from 'pdf-parse';
import { CONFIG_PATH, DB_PATH } from '../paths.js';

export type BenchmarkOptions = {
  months: number;
  out: string;
  maxMessages: number;
};

// No keyword filter — amount-based matching does the real filtering downstream,
// and "invoice OR facture OR receipt" misses SaaS receipts that use different
// wording ("Your payment was processed", "Statement", "Monthly bill"…).
const GMAIL_QUERY = 'has:attachment filename:pdf';
// Benchmark wants to measure the ceiling of a deterministic matcher, not
// the strict-runtime answer (V1 runtime will use 2/5). USD→EUR settlement
// can lag 3-7 days on FX card purchases.
const DAYS_BEFORE = 5;
const DAYS_AFTER = 10;

export async function benchmarkCommand(options: BenchmarkOptions): Promise<void> {
  console.log(chalk.bold('paperasse benchmark'));
  console.log();

  const clientId = process.env.PAPERASSE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.PAPERASSE_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      chalk.red('Credentials Google OAuth manquants (PAPERASSE_GOOGLE_CLIENT_ID/_SECRET).'),
    );
    process.exit(1);
  }

  const cfg = config.readConfig(CONFIG_PATH);
  if (!cfg) {
    console.error(chalk.red("paperasse n'est pas initialisé. Lance `paperasse init` d'abord."));
    process.exit(1);
  }

  const database = db.openDb(DB_PATH);
  const gmailToken = db.getToken(database, 'gmail');
  const qontoToken = db.getToken(database, 'qonto');
  database.close();

  if (!gmailToken?.refreshToken) {
    console.error(chalk.red('Pas de refresh token Gmail en base. Relance `paperasse init`.'));
    process.exit(1);
  }
  if (!qontoToken?.accessToken || !qontoToken.refreshToken) {
    console.error(chalk.red('Creds Qonto absentes de la base. Relance `paperasse init`.'));
    process.exit(1);
  }
  const qontoCreds: qonto.QontoCreds = {
    slug: qontoToken.refreshToken,
    secretKey: qontoToken.accessToken,
  };

  const now = new Date();
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - options.months);
  const fromIso = from.toISOString();
  const toIso = now.toISOString();
  const fromDate = fromIso.slice(0, 10);
  const toDate = toIso.slice(0, 10);

  console.log(chalk.dim(`Fenêtre : ${fromDate} → ${toDate}`));
  console.log();

  const orgSpinner = ora("Récupération de l'organisation Qonto…").start();
  let org: qonto.QontoOrganization;
  try {
    org = await qonto.getOrganization(qontoCreds);
  } catch (err) {
    orgSpinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
  const selectedIbans = cfg.qonto.bankAccountIbans ?? [];
  if (selectedIbans.length === 0) {
    orgSpinner.fail(
      chalk.red('Aucun compte sélectionné. Lance `paperasse accounts` pour en choisir.'),
    );
    process.exit(1);
  }
  const accounts = org.bankAccounts.filter((a) => selectedIbans.includes(a.iban));
  if (accounts.length === 0) {
    orgSpinner.fail(chalk.red('Comptes sélectionnés introuvables. Relance `paperasse accounts`.'));
    process.exit(1);
  }
  orgSpinner.succeed(`Qonto : ${org.legalName} — ${accounts.length} compte(s)`);

  const txSpinner = ora('Récupération des transactions Qonto…').start();
  const allTransactions: Awaited<ReturnType<typeof qonto.listTransactions>> = [];
  try {
    for (const account of accounts) {
      const rows = await qonto.listTransactions({
        creds: qontoCreds,
        iban: account.iban,
        settledAtFrom: fromIso,
        settledAtTo: toIso,
      });
      allTransactions.push(...rows);
    }
  } catch (err) {
    txSpinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
  const excluded = allTransactions.filter(
    (t) => t.attachmentIds.length === 0 && qonto.isExcludedFromMatch(t),
  );
  const unattached = allTransactions.filter(
    (t) => t.attachmentIds.length === 0 && !qonto.isExcludedFromMatch(t),
  );
  txSpinner.succeed(
    `Qonto : ${allTransactions.length} debit total, ${chalk.bold(unattached.length)} à justifier (${excluded.length} exclus : virements internes, URSSAF, frais Qonto)`,
  );

  if (unattached.length === 0) {
    console.log(chalk.yellow('Tout est déjà justifié. Rien à benchmarker.'));
    return;
  }

  const session = gmail.createGmailSession(
    { clientId, clientSecret },
    {
      accessToken: gmailToken.accessToken,
      refreshToken: gmailToken.refreshToken,
      expiresAt: gmailToken.expiresAt,
    },
  );
  gmail.onTokensRefreshed(session, (newCreds) => {
    const d = db.openDb(DB_PATH);
    try {
      db.upsertToken(d, {
        provider: 'gmail',
        accessToken: newCreds.access_token ?? gmailToken.accessToken,
        refreshToken: newCreds.refresh_token ?? gmailToken.refreshToken,
        expiresAt: newCreds.expiry_date
          ? new Date(newCreds.expiry_date).toISOString()
          : gmailToken.expiresAt,
      });
    } finally {
      d.close();
    }
  });

  // Gmail query window is wider than the per-tx match window — we want every
  // plausible invoice, the per-tx match applies the tight window.
  const searchFrom = shiftDate(fromDate, -DAYS_BEFORE);
  const searchTo = shiftDate(toDate, DAYS_AFTER);
  const query = `${GMAIL_QUERY} after:${toGmailDate(searchFrom)} before:${toGmailDate(searchTo)}`;
  const listSpinner = ora('Recherche Gmail…').start();
  let refs: Awaited<ReturnType<typeof gmail.listMessages>>;
  try {
    refs = await gmail.listMessages(session.gmail, query, options.maxMessages);
  } catch (err) {
    listSpinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
  listSpinner.succeed(`Gmail : ${refs.length} emails candidats`);

  if (refs.length === 0) {
    console.log(chalk.yellow('Aucun email avec PDF dans la fenêtre.'));
    return;
  }

  const fetchSpinner = ora(`Fetch + parse ${refs.length} emails…`).start();
  const emails: CandidateEmail[] = [];
  let i = 0;
  for (const ref of refs) {
    i += 1;
    fetchSpinner.text = `Fetch + parse ${i}/${refs.length}`;
    const parsed = await gmail.getParsedMessage(session.gmail, ref.id);

    const pdfAttachment = parsed.attachments.find(
      (a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf'),
    );
    let pdfText = '';
    if (pdfAttachment) {
      try {
        const bytes = await gmail.getAttachmentBytes(
          session.gmail,
          parsed.id,
          pdfAttachment.attachmentId,
        );
        const pdf = new PDFParse({ data: new Uint8Array(bytes) });
        const textResult = await pdf.getText();
        pdfText = textResult.text ?? '';
        await pdf.destroy();
      } catch {
        // Unparseable PDF — skip, invoice won't be a match candidate for any tx.
      }
    }

    const amounts = benchmark.extractCandidateAmountsCents(
      `${parsed.bodyText}\n${pdfText}`,
      parsed.bodyHtml,
    );
    emails.push({
      messageId: parsed.id,
      date: parsed.date,
      fromDomain: parsed.fromDomain,
      subject: parsed.subject,
      candidateAmountsCents: amounts,
    });
  }
  fetchSpinner.succeed(`Parsed ${emails.length} emails`);

  const rows: TxBenchmarkRow[] = [];
  const matchedEmailIds = new Set<string>();
  for (const tx of unattached) {
    const { classification, matches } = benchmark.classifyTransaction({
      transaction: tx,
      emails,
      daysBefore: DAYS_BEFORE,
      daysAfter: DAYS_AFTER,
    });
    for (const m of matches) matchedEmailIds.add(m.messageId);
    rows.push({
      transactionId: tx.id,
      settledAt: tx.settledAt,
      amountCents: tx.amountCents,
      localAmountCents: tx.localAmountCents,
      localCurrency: tx.localCurrency,
      label: tx.label,
      operationType: tx.operationType,
      candidateEmailIds: matches.map((m) => m.messageId),
      classification,
    });
  }

  printStats(rows, emails.length, matchedEmailIds.size);
  writeBenchmarkCsv(options.out, rows);
  console.log(chalk.dim(`\nCSV détaillé : ${options.out}`));
}

function printStats(rows: TxBenchmarkRow[], totalEmails: number, usedEmails: number): void {
  const counts: Record<TxClassification, number> = {
    matched_single: 0,
    matched_ambiguous: 0,
    no_candidate_email: 0,
  };
  for (const r of rows) counts[r.classification] += 1;

  const n = rows.length;
  const anyMatch = counts.matched_single + counts.matched_ambiguous;

  console.log();
  console.log(chalk.bold('Résultats (transaction-first)'));
  console.log(`  Transactions sans justif     ${n}`);
  console.log(
    `    matched_single             ${counts.matched_single} ${pct(counts.matched_single, n)}`,
  );
  console.log(
    `    matched_ambiguous          ${counts.matched_ambiguous} ${pct(counts.matched_ambiguous, n)}`,
  );
  console.log(
    `    no_candidate_email         ${counts.no_candidate_email} ${pct(counts.no_candidate_email, n)}`,
  );
  console.log();
  console.log(
    `  ${chalk.bold('Match rate')}  ${chalk.bold.green(`${pctRaw(anyMatch, n)}%`)}  (${anyMatch}/${n})`,
  );
  console.log();
  console.log(
    chalk.dim(
      `  Emails Gmail fetchés : ${totalEmails} — dont ${usedEmails} utilisés comme match candidat (les ${totalEmails - usedEmails} autres sont probablement perso ou hors-business).`,
    ),
  );
}

function writeBenchmarkCsv(path: string, rows: TxBenchmarkRow[]): void {
  benchmark.writeCsv(
    path,
    rows.map((r) => ({
      settled_at: r.settledAt,
      amount_cents: r.amountCents,
      local_amount_cents: r.localAmountCents,
      local_currency: r.localCurrency,
      label: r.label,
      operation_type: r.operationType,
      classification: r.classification,
      candidate_email_ids: r.candidateEmailIds.join(';'),
      transaction_id: r.transactionId,
    })),
  );
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '';
  return chalk.dim(`(${pctRaw(numerator, denominator)}%)`);
}

function pctRaw(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function toGmailDate(iso: string): string {
  return iso.replace(/-/g, '/');
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
