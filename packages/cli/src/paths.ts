import { homedir } from 'node:os';
import { join } from 'node:path';

export const PAPERASSE_HOME = join(homedir(), '.paperasse');
export const CONFIG_PATH = join(PAPERASSE_HOME, 'config.toml');
export const DB_PATH = join(PAPERASSE_HOME, 'db.sqlite');
export const PDFS_DIR = join(PAPERASSE_HOME, 'pdfs');
