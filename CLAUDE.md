# Refinr pour Obsidian

Plugin Obsidian open source (**MIT**), client de l'API REST publique de [Refinr](https://github.com/chams-bensalem/refinr)
(AGPL-3.0-only, dépôt séparé) : envoie la note active à Refinr, affiche l'aperçu du backlog Epic → Story → Sub-task,
crée les tickets dans le tracker configuré côté Refinr (Jira ou OpenProject) et écrit le résultat dans le frontmatter.
Aucune logique LLM ni tracker dans le plugin.

## Stack
- **TypeScript 5.x strict** (`strict`, `noUncheckedIndexedAccess`), esbuild, ESLint 9 + `eslint-plugin-obsidianmd`,
  Vitest ; outillage repris du gabarit officiel `obsidian-sample-plugin`.
- Choix structurants justifiés en une ligne dans `DECISIONS.md` (faits Obsidian vérifiés, sources et dates).
- Manifest : `id` `refinr`, `minAppVersion` `1.13.0` (API de réglages déclarative ; `SecretStorage` dès 1.11.4),
  `isDesktopOnly: false`. Ne jamais déclarer une version plus ancienne que les API utilisées (le lint le vérifie).

## Commandes
- Installation : `npm ci` (Node ≥ 22.12, `.nvmrc`)
- Build : `npm run build` (typage `tsc` + bundle `main.js`) · développement : `npm run dev`
- Lint : `npm run lint` (règles officielles d'Obsidian, dont la compatibilité avec `minAppVersion`)
- Tests : `npm test` (Vitest, `tests/`)
- Scan secrets : `gitleaks detect --source . --no-banner` (staged : `gitleaks protect --staged`)
- En-têtes de licence : `scripts/check-spdx.sh` (staged : `--staged`) — tout fichier source commence par
  `SPDX-FileCopyrightText: 2026 Chams Bensalem` + `SPDX-License-Identifier: MIT`
- Attribution IA : `scripts/check-ai-attribution.sh <base>..<head>` (job CI)
- Hooks git versionnés (`.githooks/` : pre-commit gitleaks + en-têtes SPDX, commit-msg anti-attribution IA) :
  `git config core.hooksPath .githooks` une fois par clone
- CI : `.github/workflows/ci.yml` (lint + build + tests sur Node 22 et 24, SPDX, gitleaks, anti-attribution IA)
- Version : `npm version <x.y.z>` (`version-bump.mjs` : `manifest.json` + `versions.json`, ni commit ni tag) ·
  contrôle : `node version-bump.mjs check <x.y.z>`
- Release : `.github/workflows/release.yml` sur push d'un tag `x.y.z` (sans `v`) → release en brouillon ; procédure
  dans le README (« Releasing »)
- Mettre cette section à jour en cas de changement d'outillage.

## Architecture (`src/`)
- `api/http.ts` : `HttpTransport` et `withTimeout` (sans Obsidian) · `api/obsidian-transport.ts` : **seul** accès
  réseau, `requestUrl` avec `throw: false` · `api/refinr-client.ts` : appels à Refinr, erreurs typées.
- `settings.ts` (valeurs, bornes) · `settings-tab.ts` (interface) · `connection.ts` (vérification, messages) ·
  `main.ts` (plugin, commandes).
- Les modules testés n'importent pas `obsidian` (au plus `import type`) : le paquet `obsidian` n'a pas de code
  exécutable hors de l'application.

## Règles
- IMPORTANT : aucun secret dans le code, les tests, les exemples, les logs ou sur GitHub. La clé d'API de Refinr vit
  uniquement dans le `SecretStorage` d'Obsidian ; `data.json` ne contient que le **nom** du secret. Jamais de clé dans un
  message, une notice ou un log.
- Git : une branche par lot de travail, intégration sur `main` uniquement par PR.
  Jamais de push direct sur `main`, jamais de force-push, jamais de changement de visibilité du repo.
- IMPORTANT : aucune attribution IA dans les commits, PR, tags ou releases : pas de `Co-Authored-By: Claude`,
  pas de « Generated with Claude Code », pas de `Claude-Session:`. Messages de commit en Conventional Commits.
- Règles du catalogue Obsidian (détail dans `DECISIONS.md`) : pas de télémétrie, pas d'obfuscation, usage réseau déclaré
  dans le README, `this.app` (jamais l'`app` global), pas d'`innerHTML`, pas de raccourci clavier par défaut, pas de
  style en ligne, casse de phrase, frontmatter écrit uniquement par `processFrontMatter`, aucune API Node/Electron.
- Aucune nouvelle dépendance d'exécution sans accord du mainteneur (aujourd'hui : aucune, tout est en devDependencies).
- Pas de changement du contrat REST de Refinr depuis ce dépôt : une évolution de Refinr passe par une PR dans `refinr`.
- Essais réels uniquement dans le coffre de test `~/dev/doc-to-jira/refinr-obsidian-test-vault`, jamais dans un coffre
  du mainteneur.
- Montrer la sortie réelle des tests/builds (pas juste « c'est vert »).
- Si une information manque, demander plutôt que deviner.
