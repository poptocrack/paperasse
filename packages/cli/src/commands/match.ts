import process from 'node:process';
import { confirm, select } from '@inquirer/prompts';
import { config, db, gmail, qonto, vendors } from '@paperasse/core';
import type { Invoice, QontoTransaction } from '@paperasse/core';
import chalk from 'chalk';
import ora from 'ora';
import { CONFIG_PATH, DB_PATH } from '../paths.js';

export type MatchOptions = {
  dry: boolean;
};

// V1 runtime window (the benchmark ceiling is wider). Invoices typically
// email 0-3 days before the card settles; EUR-denominated direct debits can
// appear same-day.
const DAYS_BEFORE = 2;
const DAYS_AFTER = 5;

export async function matchCommand(options: MatchOptions): Promise<void> {
  console.log(chalk.bold(`paperasse match${options.dry ? ' --dry' : ''}`));
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
  const qontoToken = db.getToken(database, 'qonto');
  const gmailToken = db.getToken(database, 'gmail');
  if (!qontoToken?.accessToken || !qontoToken.refreshToken) {
    database.close();
    console.error(chalk.red('Creds Qonto absentes. Relance `paperasse init`.'));
    process.exit(1);
  }
  if (!gmailToken?.refreshToken) {
    database.close();
    console.error(chalk.red('Creds Gmail absentes. Relance `paperasse init`.'));
    process.exit(1);
  }
  const qontoCreds: qonto.QontoCreds = {
    slug: qontoToken.refreshToken,
    secretKey: qontoToken.accessToken,
  };

  // Pull Qonto transactions for selected accounts over a window that covers
  // the freshest invoices in DB (60 days back is plenty for a weekly cadence).
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - 60);
  const orgSpinner = ora('Qonto : fetch org + transactions…').start();
  let transactions: QontoTransaction[] = [];
  try {
    const org = await qonto.getOrganization(qontoCreds);
    const selected = new Set(cfg.qonto.bankAccountIbans ?? []);
    const accounts = org.bankAccounts.filter((a) => selected.has(a.iban));
    if (accounts.length === 0) {
      orgSpinner.fail(chalk.red('Aucun compte sélectionné. Lance `paperasse accounts`.'));
      database.close();
      process.exit(1);
    }
    for (const account of accounts) {
      const rows = await qonto.listTransactions({
        creds: qontoCreds,
        iban: account.iban,
        settledAtFrom: windowStart.toISOString(),
        settledAtTo: now.toISOString(),
      });
      transactions = transactions.concat(rows);
    }
  } catch (err) {
    orgSpinner.fail(chalk.red((err as Error).message));
    database.close();
    process.exit(1);
  }

  const unattached = transactions.filter((t) => t.attachmentIds.length === 0 && !isExcluded(t));
  orgSpinner.succeed(
    `Qonto : ${unattached.length} transaction(s) à justifier sur ${transactions.length} debits.`,
  );

  if (unattached.length === 0) {
    console.log(chalk.green('Tout est déjà justifié côté Qonto. Rien à faire.'));
    database.close();
    return;
  }

  const invoices = db.listInvoicesByStatus(database, ['pending', 'matched', 'error']);
  console.log(chalk.dim(`${invoices.length} facture(s) en base dispo pour le match.\n`));

  const session = gmail.createGmailSession(
    { clientId, clientSecret },
    {
      accessToken: gmailToken.accessToken,
      refreshToken: gmailToken.refreshToken,
      expiresAt: gmailToken.expiresAt,
    },
  );
  gmail.onTokensRefreshed(session, (newCreds) => {
    db.upsertToken(database, {
      provider: 'gmail',
      accessToken: newCreds.access_token ?? gmailToken.accessToken,
      refreshToken: newCreds.refresh_token ?? gmailToken.refreshToken,
      expiresAt: newCreds.expiry_date
        ? new Date(newCreds.expiry_date).toISOString()
        : gmailToken.expiresAt,
    });
  });

  let uploaded = 0;
  let skipped = 0;
  let noMatch = 0;

  for (let i = 0; i < unattached.length; i++) {
    const tx = unattached[i];
    if (!tx) continue;

    console.log(chalk.cyan(`\n[${i + 1}/${unattached.length}]`), chalk.bold(formatTx(tx)));

    const candidates = findCandidateInvoices(tx, invoices);

    if (candidates.length === 0) {
      noMatch += 1;
      printNoMatchHint(tx);
      continue;
    }

    const picked = await pickInvoice(tx, candidates);
    if (picked === 'skip') {
      skipped += 1;
      continue;
    }
    if (picked === 'none') {
      noMatch += 1;
      printNoMatchHint(tx);
      continue;
    }

    if (options.dry) {
      console.log(
        chalk.yellow(
          `  [dry-run] aurait uploadé ${picked.attachmentFilename ?? 'invoice.pdf'} sur ${tx.id}`,
        ),
      );
      continue;
    }

    const uploadSpinner = ora('  Fetch PDF depuis Gmail + upload Qonto…').start();
    try {
      const bytes = await gmail.getAttachmentBytes(
        session.gmail,
        picked.messageId,
        picked.attachmentId,
      );
      await qonto.uploadAttachment({
        creds: qontoCreds,
        transactionId: tx.id,
        filename: picked.attachmentFilename ?? 'invoice.pdf',
        pdfBytes: bytes,
      });
      db.markInvoiceUploaded(database, picked.id, tx.id);
      uploaded += 1;
      uploadSpinner.succeed(chalk.green('  ✓ uploadé.'));
    } catch (err) {
      db.markInvoiceError(database, picked.id);
      uploadSpinner.fail(chalk.red(`  ✗ échec : ${(err as Error).message}`));
    }
  }

  database.close();

  console.log();
  console.log(chalk.bold('Résumé'));
  console.log(`  ${chalk.green(`✓ ${uploaded} uploadé(s)`)}`);
  console.log(`  ${chalk.yellow(`⤵ ${skipped} skippé(s)`)}`);
  console.log(`  ${chalk.red(`✗ ${noMatch} sans email candidat (voir liens ci-dessus)`)}`);
}

function findCandidateInvoices(tx: QontoTransaction, invoices: Invoice[]): Invoice[] {
  const windowStart = shiftDate(tx.settledAt, -DAYS_BEFORE);
  const windowEnd = shiftDate(tx.settledAt, DAYS_AFTER);
  return invoices
    .filter((inv) => inv.status === 'pending' || inv.status === 'matched' || inv.status === 'error')
    .filter((inv) => inv.invoiceDate >= windowStart && inv.invoiceDate <= windowEnd)
    .filter(
      (inv) =>
        inv.candidateAmountsCents.includes(tx.amountCents) ||
        inv.candidateAmountsCents.includes(tx.localAmountCents),
    );
}

async function pickInvoice(
  tx: QontoTransaction,
  candidates: Invoice[],
): Promise<Invoice | 'skip' | 'none'> {
  if (candidates.length === 1) {
    const only = candidates[0];
    if (!only) return 'skip';
    console.log(`  ${chalk.dim('→')} ${formatInvoice(only, tx)}`);
    const ok = await confirm({
      message: '  Upload ce PDF comme justificatif ?',
      default: true,
    });
    if (!ok) {
      const reason = await select({
        message: '  Pourquoi ?',
        choices: [
          { name: 'skip — cette tx, revoir plus tard', value: 'skip' as const },
          { name: 'none — aucune de ces factures ne colle', value: 'none' as const },
        ],
      });
      return reason;
    }
    return only;
  }

  const choice = await select<Invoice | 'skip' | 'none'>({
    message: `  ${candidates.length} factures candidates :`,
    choices: [
      ...candidates.map((inv) => ({
        name: formatInvoice(inv, tx),
        value: inv,
      })),
      { name: chalk.dim('— skip (revoir plus tard)'), value: 'skip' as const },
      { name: chalk.dim('— aucune ne colle'), value: 'none' as const },
    ],
  });
  return choice;
}

function printNoMatchHint(tx: QontoTransaction): void {
  const label = `${tx.label} ${tx.rawLabel}`;
  const hint = vendors.lookupVendor(label);
  console.log(`  ${chalk.red('✗')} Pas d'email candidat.`);
  if (hint) {
    console.log(
      `  ${chalk.dim('→')} ${chalk.bold(hint.name)} : ${chalk.underline(hint.billingUrl)}`,
    );
    if (hint.note) console.log(`  ${chalk.dim(hint.note)}`);
    if (hint.pdfAvailability === 'email-pdf') {
      console.log(
        chalk.dim(
          "  (Ce vendor attache normalement le PDF — vérifie que l'email n'est pas passé en spam ou dans un autre compte.)",
        ),
      );
    }
  } else {
    console.log(
      chalk.dim(
        `  Télécharge la facture depuis le portail du fournisseur (${tx.label || 'label Qonto inconnu'}) puis upload manuellement sur Qonto.`,
      ),
    );
  }
}

function formatTx(tx: QontoTransaction): string {
  const eur = formatAmount(tx.amountCents, 'EUR');
  const local =
    tx.localCurrency !== tx.currency && tx.localAmountCents !== tx.amountCents
      ? ` (${formatAmount(tx.localAmountCents, tx.localCurrency)})`
      : '';
  const label = tx.label || tx.rawLabel || '(label Qonto vide)';
  return `${label} — ${eur}${local} — ${tx.settledAt} — ${tx.operationType}`;
}

function formatInvoice(inv: Invoice, tx: QontoTransaction): string {
  // The amount that actually caused the match — either tx.amountCents (EUR
  // settlement) or tx.localAmountCents (original USD charge for FX cards).
  const matchedCents = inv.candidateAmountsCents.includes(tx.amountCents)
    ? tx.amountCents
    : tx.localAmountCents;
  const matchedCurrency = matchedCents === tx.amountCents ? tx.currency : tx.localCurrency;
  const extraCount = inv.candidateAmountsCents.filter((c) => c !== matchedCents).length;
  const extras = extraCount > 0 ? chalk.dim(` (+${extraCount} autres montants dans le PDF)`) : '';
  return `${inv.vendor} — ${inv.invoiceDate} — ${inv.attachmentFilename ?? 'invoice.pdf'} — match ${chalk.green(formatAmount(matchedCents, matchedCurrency))}${extras}`;
}

function formatAmount(cents: number, currency: string): string {
  const value = (cents / 100).toFixed(2);
  if (currency === 'EUR') return `${value}€`;
  if (currency === 'USD') return `${value}$`;
  return `${value} ${currency}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isExcluded(t: QontoTransaction): boolean {
  if (t.operationType === 'qonto_fee') return true;
  const label = `${t.label} ${t.rawLabel}`.toUpperCase();
  if (t.operationType === 'transfer' && /\b(VIR(EMENT)? INTERNE|DEBROISE)\b/.test(label))
    return true;
  if (/\bURSSAF\b/.test(label)) return true;
  return false;
}
