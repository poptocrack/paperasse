# paperasse

CLI open-source qui rapproche automatiquement les factures reçues dans Gmail avec les transactions de ton compte pro Qonto. Destiné aux dev freelances français qui en ont marre d'uploader les PDF un par un dans l'app mobile.

**Statut : pre-V1, scaffolding en cours.**

## Structure

```
packages/
  core/   # @paperasse/core — bibliothèque pure (types, schéma SQLite, matcher, extractors)
  cli/    # paperasse — CLI (commander, init/sync/match)
```

## Prérequis

- Node.js 22+
- pnpm 10+

## Dev

```bash
pnpm install
pnpm dev init                 # Lance la commande init (WIP)
pnpm dev sync --days 30       # Scan Gmail (WIP)
pnpm dev match                # TUI de matching (WIP)
pnpm build                    # Build le binaire dans packages/cli/dist/index.js
pnpm lint
pnpm typecheck
pnpm test
```

## Design doc

Le design complet (problème, ICP, prémisses, architecture, algorithme de matching, error handling, roadmap V1 → V1.1 → V2) vit dans :

`~/.gstack/projects/admin-automation/tristandebroise-main-design-20260421-105155.md`

Généré par `/office-hours` le 2026-04-21. Le chemin contient encore `admin-automation` parce que le dossier du repo n'a pas été renommé côté filesystem (optionnel).

## License

MIT
