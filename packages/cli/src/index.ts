import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { matchCommand } from './commands/match.js';
import { syncCommand } from './commands/sync.js';

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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
