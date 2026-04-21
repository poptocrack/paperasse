import chalk from 'chalk';

export type MatchOptions = {
  dry: boolean;
};

export async function matchCommand(options: MatchOptions): Promise<void> {
  console.log(chalk.bold(`paperasse match${options.dry ? ' --dry' : ''}`));
  console.log(chalk.yellow('TODO walking-skeleton day 6-8:'));
  console.log('  - Pull transactions Qonto dans la fenêtre pertinente (60j par défaut)');
  console.log('  - Pour chaque invoice en status=pending, appeler matchInvoice() du core');
  console.log(
    '  - Afficher les propositions dans un cli-table3 (vendor, montant, date facture, date tx, libellé)',
  );
  console.log(
    '  - TUI @inquirer/prompts : Y (valide et upload) / n (skip) / s (reporte au prochain run)',
  );
  console.log('  - Upload via POST /v2/transactions/{id}/attachments (multipart PDF)');
  console.log('  - Update invoices.status (matched → uploaded ou skipped)');
}
