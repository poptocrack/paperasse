# paperasse

**Réconciliation auto Gmail ↔ Qonto en CLI.** Tu scrolles tes factures SaaS (Anthropic, Stripe, Hetzner, OVH…) dans Gmail, paperasse les matche aux transactions de ton compte pro Qonto et uploade les PDFs comme justificatifs via l'API Qonto. Pour les devs freelances FR qui en ont marre de l'app mobile Qonto.

MIT · pre-V1 · Node 22+ · macOS / Linux / Windows

## Quickstart

```bash
npx paperasse init             # OAuth Gmail + Qonto API key (5 min)
npx paperasse sync --days 30   # scan Gmail → SQLite local
npx paperasse match            # TUI batch Y/n/skip, upload vers Qonto
npx paperasse status           # état, historique, heures économisées
```

**Pré-requis Qonto** : Paramètres → Intégrations et API → générer une clé API. Paperasse stocke slug + secret key dans `~/.paperasse/db.sqlite`, jamais transmis ailleurs.

**Pré-requis Gmail** : écran OAuth Google s'ouvre au premier `init`. paperasse demande le scope `gmail.readonly` uniquement.

## Ce qui marche

- **100% de match** sur les invoices qui attachent le PDF par email (Anthropic, Stripe, Hetzner, OpenAI, GitHub, Linear, Figma, DigitalOcean, Tiime, Alan…)
- **EUR + USD** : matche le montant USD du PDF au `local_amount_cents` de la tx Qonto (pas de conversion FX requise)
- **Multi-compte Qonto** : `paperasse accounts` pour choisir lesquels scanner
- **Dedup automatique** (message_id + attachment_id) — tu peux re-run `sync` sans risque
- **Aucun PDF stocké localement** — re-fetché depuis Gmail à l'upload, jamais persisté

## Ce qui marche partiellement (V1.1)

Certains SaaS (Netlify, Indy, Vercel, AWS, Google Cloud, Cloudflare…) envoient un **lien** vers la facture au lieu d'un PDF joint. Pour ceux-là, paperasse te donne l'URL du portail, tu télécharges manuellement, tu déposes le PDF dans `~/.paperasse/inbox/` et paperasse le matche au prochain `match` run.

## Limites honnêtes

- **Google OAuth en mode "Testing"** : max 100 users, chacun ajouté à la main par le mainteneur (moi). Ouvre une issue GitHub avec ton email Gmail pour être whitelisté.
- **Matching V1 : déterministe pur** (amount exact + ±2/+5 jours). Pas de LLM fallback. Si un vendor fait une promo bizarre ou une facture multi-tx, paperasse skip et te flag pour review manuelle.
- **Uniquement EUR + USD** pour le parsing des montants. GBP et autres devises = pas encore.
- **V1 = batch manuel validation Y/n/skip**. Auto-silencieux = V2, après validation que le matching tient la route.

## Commandes

| Commande | Fait quoi |
|---|---|
| `paperasse init` | Setup OAuth Gmail + Qonto API key |
| `paperasse accounts` | Change quels comptes bancaires scanner |
| `paperasse sync --days N` | Pull les factures Gmail de N derniers jours |
| `paperasse match [--dry]` | TUI match + upload (preview PDF dispo) |
| `paperasse status` | État actuel + historique + heures économisées |
| `paperasse benchmark --months N` | Mesure ton taux de match déterministe sur N mois réels |

## Debug

Creds stockées localement dans `~/.paperasse/` :
- `config.toml` : slug Qonto, org name, client_id Google (non-secret)
- `db.sqlite` : refresh tokens Gmail, secret key Qonto, invoices indexées

Tout supprimer : `rm -rf ~/.paperasse && npx paperasse init`.

Voir les invoices stockées :
```bash
sqlite3 ~/.paperasse/db.sqlite "SELECT vendor, amount_cents, status FROM invoices;"
```

## Contribuer

Issues et PRs bienvenues. Le code vit en TypeScript strict, pnpm workspace, Biome. `pnpm install && pnpm build && pnpm test`. Voir le design doc dans `docs/design.md` pour la philosophie V1 → V1.1 → V2.

## License

MIT © Tristan Debroise
