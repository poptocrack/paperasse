import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { select } from '@inquirer/prompts';
import { config, db, gmail, qonto, vendors } from '@paperasse/core';
import type { Invoice, QontoTransaction } from '@paperasse/core';
import chalk from 'chalk';
import ora from 'ora';
import { ingestInbox } from '../inbox.js';
import { CONFIG_PATH, DB_PATH, INBOX_DIR } from '../paths.js';

export type MatchOptions = {
  dry: boolean;
};

// V1 runtime window for Gmail-sourced invoices. Inbox invoices bypass this —
// the user may have dropped the PDF days/weeks after the transaction settled.
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

  // Ingest anything the user (or an agent/script) dropped into the inbox
  // since the last run. Safe no-op if the dir doesn't exist yet.
  await mkdir(INBOX_DIR, { recursive: true });
  const ingested = await ingestInbox(database, INBOX_DIR);
  if (ingested.added > 0) {
    console.log(chalk.dim(`Inbox : +${ingested.added} PDF(s) ingérés depuis ${INBOX_DIR}`));
  }

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
  const errorCount = invoices.filter((i) => i.status === 'error').length;
  console.log(chalk.dim(`${invoices.length} facture(s) en base dispo pour le match.`));
  if (errorCount > 0) {
    console.log(
      chalk.yellow(
        `⚠ ${errorCount} facture(s) en erreur au dernier run — elles seront re-proposées.`,
      ),
    );
  }
  console.log();

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

    const picked = await pickInvoiceWithPreview(tx, candidates, session.gmail);
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

    const uploadSpinner = ora('  Upload vers Qonto…').start();
    try {
      const bytes = await loadInvoiceBytes(picked, session.gmail);
      await qonto.uploadAttachment({
        creds: qontoCreds,
        transactionId: tx.id,
        filename: picked.attachmentFilename ?? 'invoice.pdf',
        pdfBytes: bytes,
      });
      db.markInvoiceUploaded(database, picked.id, tx.id);
      db.logEvent(database, {
        type: 'upload',
        invoiceId: picked.id,
        qontoTransactionId: tx.id,
        amountCents: tx.amountCents,
        metadata: { source: picked.source, vendor: picked.vendor },
      });
      if (picked.source === 'inbox') {
        // File served its purpose — remove it so the user's inbox stays clean.
        await unlink(join(INBOX_DIR, picked.attachmentId)).catch(() => {});
      }
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
  if (noMatch > 0) {
    console.log();
    console.log(
      chalk.dim(
        `Pour les ${noMatch} tx sans email : télécharge les PDFs depuis les liens, dépose-les dans ${INBOX_DIR}/, puis relance \`paperasse match\`.`,
      ),
    );
  }
}

function findCandidateInvoices(tx: QontoTransaction, invoices: Invoice[]): Invoice[] {
  const windowStart = shiftDate(tx.settledAt, -DAYS_BEFORE);
  const windowEnd = shiftDate(tx.settledAt, DAYS_AFTER);
  return invoices
    .filter((inv) => inv.status === 'pending' || inv.status === 'matched' || inv.status === 'error')
    .filter((inv) => {
      // Inbox invoices bypass the date window — the user may have downloaded
      // the PDF days after the transaction. Gmail invoices enforce the window
      // to avoid false positives from unrelated receipts.
      if (inv.source === 'inbox') return true;
      return inv.invoiceDate >= windowStart && inv.invoiceDate <= windowEnd;
    })
    .filter(
      (inv) =>
        inv.candidateAmountsCents.includes(tx.amountCents) ||
        inv.candidateAmountsCents.includes(tx.localAmountCents),
    );
}

async function pickInvoiceWithPreview(
  tx: QontoTransaction,
  candidates: Invoice[],
  gmailApi: gmail.GmailSession['gmail'],
): Promise<Invoice | 'skip' | 'none'> {
  // Loop lets the user preview one or more candidates before committing.
  while (true) {
    const choice = await select<Invoice | 'preview' | 'skip' | 'none'>({
      message: `  ${candidates.length} facture(s) candidate(s) :`,
      choices: [
        ...candidates.map((inv) => ({
          name: formatInvoice(inv, tx),
          value: inv,
        })),
        { name: chalk.dim('— preview (ouvrir le PDF dans Aperçu)'), value: 'preview' as const },
        { name: chalk.dim('— skip (revoir plus tard)'), value: 'skip' as const },
        { name: chalk.dim('— aucune ne colle'), value: 'none' as const },
      ],
    });

    if (choice !== 'preview') return choice;

    if (candidates.length === 1) {
      const only = candidates[0];
      if (only) await previewInvoice(only, gmailApi);
      continue;
    }
    const toPreview = await select<Invoice | 'back'>({
      message: '  Laquelle ouvrir ?',
      choices: [
        ...candidates.map((inv) => ({ name: formatInvoice(inv, tx), value: inv })),
        { name: chalk.dim('— retour'), value: 'back' as const },
      ],
    });
    if (toPreview !== 'back') await previewInvoice(toPreview, gmailApi);
  }
}

async function previewInvoice(inv: Invoice, gmailApi: gmail.GmailSession['gmail']): Promise<void> {
  const spinner = ora('  Préparation du preview…').start();
  try {
    if (inv.source === 'inbox') {
      spinner.stop();
      openWithDefault(join(INBOX_DIR, inv.attachmentId));
      return;
    }
    const bytes = await gmail.getAttachmentBytes(gmailApi, inv.messageId, inv.attachmentId);
    const tmpPath = join(tmpdir(), `paperasse-preview-${Date.now()}-${inv.id}.pdf`);
    await writeFile(tmpPath, bytes);
    spinner.stop();
    openWithDefault(tmpPath);
    // Give the viewer time to load the file before we clean up.
    setTimeout(() => unlink(tmpPath).catch(() => {}), 60_000);
  } catch (err) {
    spinner.fail(chalk.red(`  Preview impossible : ${(err as Error).message}`));
  }
}

function openWithDefault(path: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [path], { detached: true, stdio: 'ignore' }).unref();
}

async function loadInvoiceBytes(
  inv: Invoice,
  gmailApi: gmail.GmailSession['gmail'],
): Promise<Buffer> {
  if (inv.source === 'inbox') {
    return readFile(join(INBOX_DIR, inv.attachmentId));
  }
  return gmail.getAttachmentBytes(gmailApi, inv.messageId, inv.attachmentId);
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
          "  (Ce vendor attache normalement le PDF — vérifie que l'email n'est pas passé en spam.)",
        ),
      );
    }
  } else {
    console.log(
      chalk.dim(
        `  Télécharge la facture depuis le portail du fournisseur puis dépose-la dans ${INBOX_DIR}/.`,
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
  const matchedCents = inv.candidateAmountsCents.includes(tx.amountCents)
    ? tx.amountCents
    : tx.localAmountCents;
  const matchedCurrency = matchedCents === tx.amountCents ? tx.currency : tx.localCurrency;
  const extraCount = inv.candidateAmountsCents.filter((c) => c !== matchedCents).length;
  const extras = extraCount > 0 ? chalk.dim(` (+${extraCount} autres montants)`) : '';
  const tag = inv.source === 'inbox' ? chalk.cyan('[inbox] ') : '';
  return `${tag}${inv.vendor} — ${inv.invoiceDate} — ${inv.attachmentFilename ?? 'invoice.pdf'} — match ${chalk.green(formatAmount(matchedCents, matchedCurrency))}${extras}`;
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
