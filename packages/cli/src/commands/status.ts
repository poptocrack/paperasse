import { readdir } from 'node:fs/promises';
import process from 'node:process';
import { config, db, qonto } from '@paperasse/core';
import chalk from 'chalk';
import { CONFIG_PATH, DB_PATH, INBOX_DIR } from '../paths.js';

// Estimate how long a manual Qonto mobile upload takes, for the time-saved
// counter. 3 minutes is the founder's rough count: find tx in app, tap
// attach, pick file from Downloads, confirm, back out. Conservative.
const SECONDS_SAVED_PER_UPLOAD = 180;

export async function statusCommand(): Promise<void> {
  console.log(chalk.bold('paperasse status'));
  console.log();

  const cfg = config.readConfig(CONFIG_PATH);
  if (!cfg) {
    console.error(chalk.red("paperasse n'est pas initialisé. Lance `paperasse init` d'abord."));
    process.exit(1);
  }

  const database = db.openDb(DB_PATH);
  const counts = db.countInvoicesByStatus(database);
  const stats = db.getEventStats(database);
  const lastUpload = db.getLastEventAt(database, 'upload');
  const qontoToken = db.getToken(database, 'qonto');

  // Inbox: count PDFs waiting to be matched.
  let inboxCount = 0;
  try {
    const entries = await readdir(INBOX_DIR);
    inboxCount = entries.filter((f) => f.toLowerCase().endsWith('.pdf')).length;
  } catch {
    // dir doesn't exist yet
  }

  // Live Qonto count of transactions still missing a justif (best-effort).
  let qontoMissing: number | null = null;
  if (qontoToken?.accessToken && qontoToken.refreshToken) {
    try {
      const org = await qonto.getOrganization({
        slug: qontoToken.refreshToken,
        secretKey: qontoToken.accessToken,
      });
      const selected = new Set(cfg.qonto.bankAccountIbans ?? []);
      const accounts = org.bankAccounts.filter((a) => selected.has(a.iban));
      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setUTCDate(windowStart.getUTCDate() - 60);
      let txs: Awaited<ReturnType<typeof qonto.listTransactions>> = [];
      for (const account of accounts) {
        const rows = await qonto.listTransactions({
          creds: { slug: qontoToken.refreshToken, secretKey: qontoToken.accessToken },
          iban: account.iban,
          settledAtFrom: windowStart.toISOString(),
          settledAtTo: now.toISOString(),
        });
        txs = txs.concat(rows);
      }
      // Same filter as `match` — exclude self-transfers, URSSAF, qonto_fees.
      qontoMissing = txs.filter(
        (t) => t.attachmentIds.length === 0 && !qonto.isExcludedFromMatch(t),
      ).length;
    } catch {
      qontoMissing = null;
    }
  }

  database.close();

  console.log(chalk.bold('Organisation'));
  console.log(`  ${cfg.qonto.organizationName} — ${cfg.qonto.bankAccountIbans.length} compte(s)`);
  console.log();

  console.log(chalk.bold('Factures en base'));
  console.log(`  ${chalk.dim('pending   ')} ${counts.pending}`);
  console.log(`  ${chalk.dim('matched   ')} ${counts.matched}`);
  console.log(`  ${chalk.green('uploaded  ')} ${counts.uploaded}`);
  console.log(`  ${chalk.dim('skipped   ')} ${counts.skipped}`);
  if (counts.error > 0) {
    console.log(
      `  ${chalk.yellow('error     ')} ${counts.error} ${chalk.dim('(re-proposées au prochain match)')}`,
    );
  }
  console.log();

  console.log(chalk.bold('Qonto'));
  if (qontoMissing === null) {
    console.log(chalk.dim('  (impossible de joindre Qonto maintenant — skip)'));
  } else {
    console.log(
      `  ${qontoMissing} tx sans justif${qontoMissing > 0 ? chalk.dim(' — lance `paperasse match`') : ''}`,
    );
  }
  console.log();

  console.log(chalk.bold('Inbox'));
  console.log(`  ${inboxCount} PDF(s) dans ${INBOX_DIR}/`);
  console.log();

  console.log(chalk.bold('Historique'));
  if (stats.uploadsTotal === 0) {
    console.log(chalk.dim('  Aucun upload encore. Lance `paperasse match` pour commencer.'));
  } else {
    const hoursTotal = ((stats.uploadsTotal * SECONDS_SAVED_PER_UPLOAD) / 3600).toFixed(1);
    const hours30 = ((stats.uploadsLast30d * SECONDS_SAVED_PER_UPLOAD) / 3600).toFixed(1);
    console.log(
      `  ${stats.uploadsTotal} upload(s) depuis le début  (~${hoursTotal}h économisées, ${formatEur(stats.amountMatchedCentsTotal)} matché)`,
    );
    console.log(
      `  ${stats.uploadsLast30d} upload(s) sur 30 j           (~${hours30}h économisées, ${formatEur(stats.amountMatchedCentsLast30d)} matché)`,
    );
    if (lastUpload) {
      console.log(chalk.dim(`  Dernier upload : ${formatRelative(lastUpload)}`));
    }
  }
}

function formatEur(cents: number): string {
  return `${(cents / 100).toFixed(0)}€`;
}

function formatRelative(iso: string): string {
  const d = new Date(`${iso.replace(' ', 'T')}Z`);
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `il y a ${days} j`;
}
