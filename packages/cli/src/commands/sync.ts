import process from 'node:process';
import { benchmark, config, db, gmail, vendors } from '@paperasse/core';
import chalk from 'chalk';
import ora from 'ora';
import { PDFParse } from 'pdf-parse';
import { CONFIG_PATH, DB_PATH } from '../paths.js';

export type SyncOptions = {
  days: number;
};

const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'yahoo.fr',
  'hotmail.fr',
  'hotmail.com',
  'outlook.com',
  'outlook.fr',
  'icloud.com',
  'me.com',
  'free.fr',
  'orange.fr',
  'wanadoo.fr',
  'sfr.fr',
  'numericable.fr',
  'laposte.net',
  'proton.me',
  'protonmail.com',
]);

export async function syncCommand(options: SyncOptions): Promise<void> {
  console.log(chalk.bold(`paperasse sync --days ${options.days}`));
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
  if (!gmailToken?.refreshToken) {
    database.close();
    console.error(chalk.red('Pas de refresh token Gmail. Relance `paperasse init`.'));
    process.exit(1);
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
    db.upsertToken(database, {
      provider: 'gmail',
      accessToken: newCreds.access_token ?? gmailToken.accessToken,
      refreshToken: newCreds.refresh_token ?? gmailToken.refreshToken,
      expiresAt: newCreds.expiry_date
        ? new Date(newCreds.expiry_date).toISOString()
        : gmailToken.expiresAt,
    });
  });

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - options.days);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);

  const query = `has:attachment filename:pdf after:${toGmail(fromDate)} before:${toGmail(toDate)}`;
  const listSpinner = ora(`Recherche Gmail (${options.days} derniers jours)…`).start();
  let refs: Awaited<ReturnType<typeof gmail.listMessages>>;
  try {
    refs = await gmail.listMessages(session.gmail, query, 500);
  } catch (err) {
    database.close();
    listSpinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
  listSpinner.succeed(`${refs.length} emails avec PDF trouvés`);

  if (refs.length === 0) {
    database.close();
    return;
  }

  const processSpinner = ora(`Extraction ${refs.length} emails…`).start();
  let added = 0;
  let skipped = 0;
  let errors = 0;
  let personal = 0;
  let i = 0;
  for (const ref of refs) {
    i += 1;
    processSpinner.text = `Extraction ${i}/${refs.length}`;
    try {
      const parsed = await gmail.getParsedMessage(session.gmail, ref.id);

      if (PERSONAL_DOMAINS.has(parsed.fromDomain)) {
        personal += 1;
        continue;
      }

      const pdfAttachment = parsed.attachments.find(
        (a) => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf'),
      );
      if (!pdfAttachment) {
        skipped += 1;
        continue;
      }

      let pdfText = '';
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
        // PDF unreadable — fall back to body-only extraction.
      }

      const candidates = benchmark.extractCandidateAmountsCents(
        `${parsed.bodyText}\n${pdfText}`,
        parsed.bodyHtml,
      );
      if (candidates.length === 0) {
        skipped += 1;
        continue;
      }

      const primaryAmount = candidates[0] ?? 0;
      const vendor = resolveVendorKey(parsed.fromDomain, parsed.subject);

      const inserted = db.upsertInvoice(database, {
        messageId: parsed.id,
        attachmentId: pdfAttachment.attachmentId,
        attachmentFilename: pdfAttachment.filename,
        vendor,
        fromDomain: parsed.fromDomain,
        subject: parsed.subject,
        amountCents: primaryAmount,
        currency: 'EUR',
        candidateAmountsCents: candidates,
        invoiceDate: parsed.date,
        status: 'pending',
        qontoTransactionId: null,
      });
      if (inserted) added += 1;
      else skipped += 1;
    } catch {
      errors += 1;
    }
  }
  processSpinner.succeed(
    `Sync terminé : ${chalk.bold.green(`+${added}`)} nouvelles / ${chalk.dim(`${skipped + personal} ignorées`)} / ${chalk.yellow(`${errors} erreurs`)}`,
  );
  if (personal > 0) {
    console.log(chalk.dim(`  (${personal} emails depuis des domaines persos filtrés)`));
  }

  const pending = db.listInvoicesByStatus(database, 'pending');
  database.close();
  console.log(
    `\n${chalk.bold(pending.length)} facture(s) en attente de match. Prochaine étape : ${chalk.bold('paperasse match')}`,
  );
}

// Best-effort vendor key: prefer the registry's canonical key, fall back to
// stripping common marketing subdomains + TLD from the email's from domain.
function resolveVendorKey(fromDomain: string, subject: string): string {
  const hint = vendors.lookupVendor(fromDomain) ?? vendors.lookupVendor(subject);
  if (hint) return hint.key;
  const cleaned = fromDomain
    .toLowerCase()
    .replace(
      /^(?:mail|email|e?mails?|billing|invoice|receipt|no[- ]?reply|notifications?|hello|support|noreply)\./,
      '',
    );
  const labels = cleaned.split('.');
  if (labels.length <= 2) return labels[0] ?? cleaned;
  return labels[labels.length - 2] ?? cleaned;
}

function toGmail(iso: string): string {
  return iso.replace(/-/g, '/');
}
