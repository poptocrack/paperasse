import chalk from 'chalk';

export type SyncOptions = {
  days: number;
};

export async function syncCommand(options: SyncOptions): Promise<void> {
  console.log(chalk.bold(`paperasse sync (--days ${options.days})`));
  console.log(chalk.yellow('TODO walking-skeleton day 3-5:'));
  console.log('  - Pull Gmail messages des N derniers jours avec la whitelist de senders');
  console.log(
    '  - Pour chaque message, résoudre le SenderExtractor et extraire {vendor, amount, date, pdfData}',
  );
  console.log('  - Dedup via (message_id, attachment_hash) dans SQLite');
  console.log('  - Stocker le PDF local dans ~/.paperasse/pdfs/{YYYY-MM}/');
  console.log('  - Afficher : N factures nouvelles / M ignorées / K erreurs');
}
