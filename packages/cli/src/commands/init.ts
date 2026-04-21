import { mkdir } from 'node:fs/promises';
import process from 'node:process';
import { checkbox, confirm, input, password } from '@inquirer/prompts';
import { config, db, gmail, qonto } from '@paperasse/core';
import chalk from 'chalk';
import ora from 'ora';
import { getGoogleCreds } from '../env.js';
import { CONFIG_PATH, DB_PATH, PAPERASSE_HOME } from '../paths.js';

export async function initCommand(): Promise<void> {
  console.log(chalk.bold('paperasse init'));
  console.log();

  const { clientId, clientSecret } = getGoogleCreds();
  if (!clientId || !clientSecret) {
    console.error(
      chalk.red(
        'Credentials Google OAuth manquants. Ouvre une issue GitHub avec ton email pour être whitelisté en mode Testing.',
      ),
    );
    process.exit(1);
  }

  const existing = config.readConfig(CONFIG_PATH);
  if (existing) {
    const overwrite = await confirm({
      message: `paperasse est déjà configuré pour ${existing.qonto.organizationName}. Ré-initialiser ?`,
      default: false,
    });
    if (!overwrite) {
      console.log('Abandon.');
      return;
    }
  }

  await mkdir(PAPERASSE_HOME, { recursive: true });

  console.log(chalk.cyan('\nÉtape 1/2 — Gmail'));
  console.log("Ouverture du navigateur pour autoriser l'accès Gmail (scope readonly)…\n");
  const gmailTokens = await gmail.runOAuthFlow({ clientId, clientSecret });
  if (!gmailTokens.refresh_token) {
    console.error(
      chalk.red(
        "Google n'a pas renvoyé de refresh_token. Révoque l'accès paperasse sur https://myaccount.google.com/permissions puis relance init.",
      ),
    );
    process.exit(1);
  }
  console.log(chalk.green('✓ Gmail autorisé.'));

  console.log(chalk.cyan('\nÉtape 2/2 — Qonto'));
  console.log('Récupère ton slug et une secret key dans Qonto → Paramètres → Intégrations et API.');
  const slug = await input({
    message: 'Qonto slug (ex: macompta-1234)',
    validate: (v) => (v.trim().length > 0 ? true : 'Slug requis'),
  });
  const secretKey = await password({
    message: 'Qonto secret key',
    mask: true,
    validate: (v) => (v.trim().length > 0 ? true : 'Secret key requise'),
  });

  const spinner = ora('Vérification des creds Qonto…').start();
  let org: qonto.QontoOrganization;
  try {
    org = await qonto.verifyQontoCreds({ slug: slug.trim(), secretKey: secretKey.trim() });
  } catch (err) {
    spinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
  spinner.succeed(chalk.green(`Qonto connecté : ${org.legalName}`));

  if (org.bankAccounts.length === 0) {
    console.error(chalk.red('Aucun bank account trouvé sur cette organisation Qonto.'));
    process.exit(1);
  }

  let selectedIbans: string[];
  if (org.bankAccounts.length === 1) {
    const only = org.bankAccounts[0];
    if (!only) {
      console.error(chalk.red('Bank account introuvable.'));
      process.exit(1);
    }
    selectedIbans = [only.iban];
    console.log(
      chalk.dim(`Un seul compte détecté (${formatBankAccount(only)}) — auto-sélectionné.`),
    );
  } else {
    selectedIbans = await checkbox({
      message: 'Quels comptes bancaires paperasse doit-il scanner ?',
      choices: org.bankAccounts.map((a) => ({
        name: formatBankAccount(a),
        value: a.iban,
        checked: true,
      })),
      required: true,
    });
  }

  const database = db.openDb(DB_PATH);
  try {
    database.transaction(() => {
      database.prepare('DELETE FROM tokens WHERE provider IN (?, ?)').run('gmail', 'qonto');
      db.upsertToken(database, {
        provider: 'gmail',
        accessToken: gmailTokens.access_token ?? null,
        refreshToken: gmailTokens.refresh_token ?? null,
        expiresAt: gmailTokens.expiry_date ? new Date(gmailTokens.expiry_date).toISOString() : null,
      });
      // Qonto API keys don't expire. We piggyback the slug on refresh_token to
      // keep the schema unchanged — access_token holds the secret.
      db.upsertToken(database, {
        provider: 'qonto',
        accessToken: secretKey.trim(),
        refreshToken: org.slug,
        expiresAt: null,
      });
    })();
  } finally {
    database.close();
  }

  config.writeConfig(CONFIG_PATH, {
    version: config.CONFIG_VERSION,
    qonto: {
      slug: org.slug,
      organizationName: org.legalName,
      bankAccountIbans: selectedIbans,
    },
    gmail: { clientId },
  });

  console.log();
  console.log(chalk.green(`✓ Setup terminé. État sauvegardé dans ${PAPERASSE_HOME}/`));
  console.log(`Prochaine étape : ${chalk.bold('paperasse sync --days 30')}`);
}

function formatBankAccount(a: qonto.QontoBankAccount): string {
  const last4 = a.iban.slice(-4);
  const title = a.name || a.slug || 'compte';
  return `${title} — ${a.iban.slice(0, 4)}…${last4} (${a.currency})`;
}
