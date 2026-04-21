import chalk from 'chalk';
import { CONFIG_PATH, PAPERASSE_HOME } from '../paths.js';

export async function initCommand(): Promise<void> {
  console.log(chalk.bold('paperasse init'));
  console.log(`Home dir : ${PAPERASSE_HOME}`);
  console.log(`Config   : ${CONFIG_PATH}`);
  console.log();
  console.log(chalk.yellow('TODO walking-skeleton day 1-2:'));
  console.log('  - Lancer le flow OAuth Gmail (loopback localhost, scope gmail.readonly)');
  console.log("  - Demander à l'user son Qonto slug + API key (Paramètres > Intégrations)");
  console.log('  - Créer ~/.paperasse/ + config.toml + db.sqlite');
  console.log('  - Vérifier la connexion Qonto (GET /v2/organizations)');
}
