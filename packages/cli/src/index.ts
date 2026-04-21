import { Command } from 'commander';
import { accountsCommand } from './commands/accounts.js';
import { benchmarkCommand } from './commands/benchmark.js';
import { initCommand } from './commands/init.js';
import { matchCommand } from './commands/match.js';
import { statusCommand } from './commands/status.js';
import { syncCommand } from './commands/sync.js';
import { loadDevEnv } from './env.js';

loadDevEnv();

const program = new Command();

program
  .name('paperasse')
  .description('Rapproche tes factures Gmail avec tes transactions Qonto, en CLI.')
  .version('0.0.0');

program
  .command('init')
  .description('Setup interactif : OAuth Gmail + Qonto API key.')
  .action(async () => {
    await initCommand();
  });

program
  .command('accounts')
  .description('Change les comptes bancaires Qonto que paperasse scanne.')
  .action(async () => {
    await accountsCommand();
  });

program
  .command('status')
  .description('État actuel : factures en base, tx Qonto sans justif, inbox, historique.')
  .action(async () => {
    await statusCommand();
  });

program
  .command('sync')
  .description('Scan Gmail, extrait les factures, dedup, stocke local.')
  .option('--days <n>', 'nombre de jours à scanner', (v) => Number.parseInt(v, 10), 30)
  .action(async (options: { days: number }) => {
    await syncCommand({ days: options.days });
  });

program
  .command('match')
  .description('Propose les matchs facture ↔ transaction, valide en batch Y/n/skip.')
  .option('--dry', "n'upload rien, affiche juste les propositions", false)
  .action(async (options: { dry: boolean }) => {
    await matchCommand({ dry: options.dry });
  });

program
  .command('benchmark')
  .description(
    'Mesure le taux de matching déterministe sur ton historique réel (Phase 1 du design doc).',
  )
  .option('--months <n>', 'fenêtre en mois', (v) => Number.parseInt(v, 10), 3)
  .option('--out <path>', 'chemin du CSV détaillé', 'benchmark.csv')
  .option(
    '--max-messages <n>',
    'plafond nombre de messages Gmail à fetcher',
    (v) => Number.parseInt(v, 10),
    500,
  )
  .action(async (options: { months: number; out: string; maxMessages: number }) => {
    await benchmarkCommand({
      months: options.months,
      out: options.out,
      maxMessages: options.maxMessages,
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
