import process from 'node:process';
import { checkbox } from '@inquirer/prompts';
import { config, db, qonto } from '@paperasse/core';
import chalk from 'chalk';
import ora from 'ora';
import { CONFIG_PATH, DB_PATH } from '../paths.js';

export async function accountsCommand(): Promise<void> {
  console.log(chalk.bold('paperasse accounts'));
  console.log();

  const cfg = config.readConfig(CONFIG_PATH);
  if (!cfg) {
    console.error(chalk.red("paperasse n'est pas initialisé. Lance `paperasse init` d'abord."));
    process.exit(1);
  }

  const database = db.openDb(DB_PATH);
  const qontoToken = db.getToken(database, 'qonto');
  database.close();

  if (!qontoToken?.accessToken || !qontoToken.refreshToken) {
    console.error(chalk.red('Creds Qonto absentes de la base. Relance `paperasse init`.'));
    process.exit(1);
  }
  const qontoCreds: qonto.QontoCreds = {
    slug: qontoToken.refreshToken,
    secretKey: qontoToken.accessToken,
  };

  const spinner = ora('Récupération des comptes Qonto…').start();
  let org: qonto.QontoOrganization;
  try {
    org = await qonto.getOrganization(qontoCreds);
  } catch (err) {
    spinner.fail(chalk.red((err as Error).message));
    process.exit(1);
  }
  spinner.succeed(`${org.bankAccounts.length} compte(s) trouvé(s)`);

  if (org.bankAccounts.length === 0) {
    console.error(chalk.red('Aucun bank account sur cette organisation.'));
    process.exit(1);
  }

  const previouslySelected = new Set(cfg.qonto.bankAccountIbans ?? []);
  const selectedIbans = await checkbox({
    message: 'Comptes à scanner :',
    choices: org.bankAccounts.map((a) => ({
      name: formatBankAccount(a),
      value: a.iban,
      checked: previouslySelected.has(a.iban),
    })),
    required: true,
  });

  config.writeConfig(CONFIG_PATH, {
    ...cfg,
    qonto: { ...cfg.qonto, bankAccountIbans: selectedIbans },
  });

  console.log();
  console.log(chalk.green(`✓ ${selectedIbans.length} compte(s) sélectionné(s).`));
}

function formatBankAccount(a: qonto.QontoBankAccount): string {
  const last4 = a.iban.slice(-4);
  const title = a.name || a.slug || 'compte';
  return `${title} — ${a.iban.slice(0, 4)}…${last4} (${a.currency})`;
}
