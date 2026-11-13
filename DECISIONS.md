# Décisions techniques

Une ligne par choix structurant : le fait constaté (source), puis la décision ou sa conséquence.
Sources consultées le 2026-11-13 :
- API `obsidian` **1.14.4** sur npm (`obsidian.d.ts`, modifié le 2026-10-08) ;
- gabarit `obsidianmd/obsidian-sample-plugin`, commit `07ceb81` (2026-08-02) ;
- documentation officielle `obsidianmd/obsidian-developer-docs` (branche `main`, poussée le 2026-10-21) ;
- `obsidianmd/obsidian-releases` : dernière version de l'application **1.15.1** (2026-11-12), `community-plugins.json`
  (10 346 plugins).

Mention **« documenté, à confirmer à l'exécution »** : fait tiré de la documentation ou des types, qui ne peut être
prouvé qu'en exécutant Obsidian. Ces points sont repris dans la liste de l'essai réel (P4) en fin de fichier.

## Phase P0 — Reconnaissance Obsidian

### Structure, build, outillage
- **Fichiers livrés** : `main.js` (bundle), `manifest.json` et `styles.css` (facultatif), joints à une release GitHub
  dont le tag est **égal** à `manifest.version` (`x.y.z`, sans `v`). `versions.json` (version du plugin →
  `minAppVersion`) permet à Obsidian de proposer la dernière version compatible aux applications plus anciennes.
  Source : *Submit your plugin*, README de `obsidian-releases`.
- **Build du gabarit** : TypeScript (`tsc -noEmit` pour le typage) + esbuild (`src/main.ts` → `main.js`, CJS,
  `es2021`, `obsidian`/`electron`/`@codemirror/*`/modules Node en `external`), minifié en production. `tsconfig`
  `strict` + `noUncheckedIndexedAccess`. Lint : ESLint 9 + **`eslint-plugin-obsidianmd`** (`configs.recommended`).
  CI du gabarit : build + lint sur Node 20/22/24 ; workflow de release sur tag (brouillon de release et attestation de
  provenance de `main.js`). → **Repris tel quel en P1**, avec en plus les tests, gitleaks et SPDX.
- **Versions de l'outillage** : le gabarit fixe `esbuild 0.25.5`, `typescript ^5.8.3`, `eslint-plugin-obsidianmd
  ^0.4.0` et `obsidian: latest`. Sur npm aujourd'hui : esbuild 0.28.2, TypeScript **7.0.2**, plugin ESLint 0.5.1. →
  En P1, **épingler `obsidian` à une version exacte** (au lieu de `latest`) et rester sur **TypeScript 5.x** comme le
  gabarit (décision du mainteneur, 2026-11-13 ; TS 7 est une réécriture native que le gabarit ne suit pas encore).
  Chaque choix sera justifié ici.
- **Minification autorisée, obfuscation interdite** : la politique interdit d'« obfusquer le code pour en cacher le
  but » ; le gabarit minifie lui-même. → On garde la minification du gabarit ; le code source reste public.

### `minAppVersion`
- `since` relevés dans `obsidian.d.ts` : `processFrontMatter` 1.4.4, `getFrontMatterInfo` 1.5.7,
  `Setting.addComponent` 1.11.0, `SecretComponent` 1.11.1, **`App.secretStorage` / `SecretStorage` 1.11.4**,
  `SecretComponent.setValue`/`onChange` 1.11.4.
- La règle de soumission demande la version minimale **réellement compatible** (à défaut, la dernière version stable).
- → ~~`minAppVersion: "1.11.4"`~~ (version minimale de `SecretStorage`) ; **porté à `1.13.0` en P1** (décision du
  mainteneur : ne jamais déclarer une version plus ancienne que les API utilisées ; l'onglet de réglages utilise
  l'API déclarative de 1.13.0, cf. section P1). Pas de solution de secours en clair pour les versions plus anciennes.
  L'Obsidian installé ici est en 1.13.4 et la dernière version est la 1.15.1.

### Appels HTTP
- `requestUrl(param)` : « comme `fetch()`, sans restriction CORS ». Paramètres : `url`, `method`, `contentType`,
  `body` (`string | ArrayBuffer`), `headers`, **`throw`** (par défaut `true` : exception dès 400). Réponse : `status`,
  `headers`, `text`, `json`, `arrayBuffer`. **Pas de délai d'expiration ni d'annulation** dans l'API.
- `fetch` reste soumis au CORS de la WebView : Refinr limite le CORS à `refinr.cors.allowed-origins` (défaut
  `http://localhost:3000`, `*` refusé), et l'origine d'Obsidian n'en fait pas partie.
- Filtres de Refinr qui concernent le plugin (`HttpSecurityConfiguration`) : en-tête **`Host`** limité à
  `refinr.security.allowed-hosts` (défaut `localhost,127.0.0.1,[::1]`, anti DNS rebinding) → un Refinr appelé par une
  autre adresse (mobile, réseau local) doit l'ajouter à `REFINR_ALLOWED_HOSTS` (à écrire dans le README en P4). Corps
  plafonné à 5 Mio (`refinr.http.max-body-bytes`), bien au-delà de 200 000 caractères. Clé `X-API-Key` facultative
  (`refinr.security.api-key` vide = désactivée).
- Si `requestUrl` envoie un en-tête `Origin` non autorisé, le filtre CORS de Spring peut répondre **403** :
  **documenté, à confirmer à l'exécution** (sur desktop, la requête passe a priori par le processus principal, sans
  `Origin`). Contournement possible : ajouter l'origine d'Obsidian à `CORS_ALLOWED_ORIGINS`.
- → **`requestUrl` uniquement**, avec `throw: false` pour lire nous-mêmes 400/401/409/413/502 et reprendre le message de
  l'API. Délai géré par le plugin (`Promise.race`) : il cesse d'attendre, mais la requête n'est pas annulée. Refinr
  borne l'analyse à 300 s (`refinr.llm.analysis.timeout`) et le verdict à 90 s (`refinr.llm.verdict.timeout`), avec
  des relances → délai par défaut côté plugin d'au moins 7 min pour `analyze-preview`, plus court pour `/health`,
  `/source` et `/tracker`. Un délai dépassé sur `create-jira` est signalé comme **« état inconnu, vérifier le tracker »**,
  jamais relancé (même règle que Refinr : POST non idempotent).
- **Fonctionnement sur mobile** : `requestUrl` est l'API multiplateforme fournie par Obsidian, mais la documentation ne
  le dit pas explicitement — **documenté, à confirmer à l'exécution**. Idem pour un Refinr en `http://` (non TLS) ou
  sur `localhost`, inaccessible depuis un téléphone.
- → ~~`isDesktopOnly: false`~~ : aucune API Node/Electron n'est nécessaire (règle de soumission : Node/Electron ⇒
  `true` obligatoire). Lint et revue vérifieront qu'aucun import Node ne s'y glisse, et qu'il n'y a pas de lookbehind
  dans les regex (non pris en charge sur iOS < 16.4).
  **Révisé en P4 (décision du mainteneur) : `isDesktopOnly: true` pour la 0.1.0.** Le code reste compatible mobile
  (aucune API Node/Electron), mais rien n'a été vérifié sur mobile : en-tête `Origin` de `requestUrl` (403 CORS
  possible), `SecretStorage`, rendu des fenêtres, et un téléphone ne joint pas un Refinr sur `localhost`. Plutôt que de
  proposer une expérience non testée, le plugin n'est pas proposé sur iOS/Android ; retour à `false` après un essai
  mobile, sans changement de code.

### Note active et frontmatter
- Note active : `workspace.getActiveFile()` (ou `getActiveViewOfType(MarkdownView)`) ; `workspace.activeLeaf` est
  déconseillé (*Plugin guidelines*).
- Lecture : `vault.cachedRead(file)` ; `getFrontMatterInfo(content)` renvoie `exists`, `frontmatter`, `from`, `to` et
  **`contentStart`** (fin du bloc, `---` compris). → Texte envoyé = `content.slice(contentStart)`.
- Écriture : `fileManager.processFrontMatter(file, fn)` est atomique (lecture, mutation synchrone, écriture). Elle lève
  `YAMLParseError` si le YAML existant est invalide, et relance les erreurs du callback. C'est la méthode exigée par les
  guidelines (pas d'analyse YAML maison). → Écriture du frontmatter **uniquement** par `processFrontMatter`, erreurs
  attrapées et affichées. Le callback reste synchrone : tous les appels réseau sont faits avant.
- Conservation de la mise en page, des commentaires YAML et de l'ordre des autres clés après `processFrontMatter` :
  **documenté, à confirmer à l'exécution**.

### Inclusions `![[…]]`
- `metadataCache.getFileCache(file)` → `CachedMetadata` (ou `null` si la note n'est pas encore indexée) : `embeds`
  (`link`, `original`, `displayText`, `position`), `headings`, `blocks` (`Record<id, BlockCache>`), `sections`.
- `parseLinktext(link)` → `{ path, subpath }` ; `metadataCache.getFirstLinkpathDest(path, sourcePath)` → `TFile | null`
  (résolution relative à la note source, comme Obsidian) ; `resolveSubpath(cache, '#titre' | '#^bloc')` →
  `HeadingSubpathResult` (`start`, `end` = début du titre suivant de même niveau ou supérieur, ou `null` = fin du
  fichier) ou `BlockSubpathResult` (`block`, `list?`), ou `null` si la section est introuvable.
- → Algorithme P2 : pour chaque `embed` (ordre décroissant des positions pour remplacer sans décaler les offsets),
  résoudre la cible, ne développer que les **fichiers `.md`** (images, PDF, audio et `.canvas` restent en texte, avec un
  avertissement) ; tronquer selon `subpath` grâce aux offsets ; retirer le frontmatter de la note incluse ; recursion
  bornée (profondeur, taille cumulée) avec un ensemble `chemin#subpath` pour détecter les boucles ; cible ou section
  introuvable → texte d'origine + avertissement. `[[liens]]` simples : non touchés (absents de `embeds`).
  Cache `null` → la note est envoyée sans expansion, avec un avertissement.
- Fonction d'expansion **pure** (entrées : contenu, cache et résolveur injectés) → testable sans Obsidian.
- À confirmer à l'exécution (**documenté, à confirmer à l'exécution**) : `embeds` exclut les `![[…]]` situés dans
  des blocs ou des spans de code ; périmètre exact d'un bloc `^id` d'élément de liste (avec ou sans sous-éléments) ;
  fraîcheur du cache juste après une modification non encore indexée.

### Clé d'API
- Il existe une **API de stockage de secrets** : `app.secretStorage` (`setSecret(id, secret)`, `getSecret(id)` →
  `string | null`, `listSecrets()`) et `SecretComponent` (sélection ou création d'un secret dans les réglages, via
  `Setting.addComponent`). Les réglages ne conservent que le **nom** du secret. D'après le guide *Store secrets*, la
  valeur est « stockée dans le local storage, propre au coffre », et non dans `data.json`. Le secret est partageable entre
  plugins (l'utilisateur le choisit par son nom). Source : guide *Store secrets*, `obsidian.d.ts`.
- → **Clé d'API via `SecretStorage` uniquement** (`settings.apiKeySecret` = nom du secret) ; jamais dans `data.json`,
  jamais affichée, jamais journalisée. Clé absente → appels sans `X-API-Key` (Refinr peut fonctionner sans).
- Le stockage n'est **pas** décrit comme chiffré par la documentation. → Texte du réglage et du README (décision du
  mainteneur, P1) : « Stored by Obsidian on this device, outside your vault files (so it is not synced with your
  notes). How it is protected depends on Obsidian and your operating system. » — ni « encrypted » ni « not
  encrypted », jamais « sécurisé ».
- **Documenté, à confirmer à l'exécution** : absence réelle de la valeur dans `.obsidian/` (donc non synchronisée ni
  versionnée), disponibilité sur mobile, persistance après redémarrage, comportement de Obsidian Sync (secret à
  ressaisir sur chaque appareil ?).

### Limite de taille
- Refinr expose `GET /api/v1/source` → `{ "name", "maxContentChars" }`. Défaut 200 000 caractères, **titre compris**,
  propriété `refinr.document.max-content-chars`. Au-delà, réponse **413** sans appel au modèle.
- → Le plugin lit `maxContentChars` (à la connexion et avant chaque analyse) et refuse localement si
  `content.length + title.length` dépasse la limite (message avec les deux tailles). Le 413 reste traité (limite
  modifiée entre-temps). Le réglage « taille max envoyée » prévu en P1 devient inutile, et seule la taille max des
  inclusions reste réglable.
  ~~Unité : caractères JavaScript (UTF-16), comme `String.length()` côté Java.~~ **Corrigé en P2** : Refinr compte
  le texte `"# " + titre + "\n\n" + contenu` en **code points** (`DocumentAnalysis.providedText`,
  `codePointCount`), cf. section P2.

### Règles de publication (à respecter dès P1)
- **Interdit** (*Developer policies*) : obfuscation, publicité dynamique, télémétrie côté client, auto-installation ou
  auto-mise à jour (du plugin ou de ses dépendances).
- **À déclarer dans le README** : usage du réseau (quel service et pourquoi : le serveur Refinr configuré par
  l'utilisateur, et rien d'autre) ; compte requis le cas échéant (instance Refinr et tracker de l'utilisateur).
- **Licence** : fichier `LICENSE` obligatoire et licence clairement indiquée ; respect des licences du code réutilisé
  (gabarit sous 0BSD : aucune obligation d'attribution).
- **Marque** : ne pas laisser croire à un plugin officiel. Le `name` ne contient ni « Obsidian » (ni « Obsi- »,
  « -sidian ») ni « Plugin », en caractères latins de base. Pas de nom de fonctionnalité native.
- **Manifest** (*Manifest*, *Submission requirements*) : `id` en minuscules et tirets, sans `obsidian`, ne finissant
  pas par `plugin`, unique ; `isDesktopOnly` obligatoire ; `fundingUrl` seulement pour des dons (sinon absent) ;
  description ≤ 250 caractères, commençant par un verbe d'action, terminée par un point, sans emoji ; pas d'ID de plugin
  dans les ID de commande ; aucun code du gabarit restant.
- **Guidelines** : `this.app` (pas l'`app` global) ; journalisation minimale (erreurs seulement) ; pas de
  `innerHTML`/`outerHTML`/`insertAdjacentHTML` (utiliser `createEl`/`createDiv`, `el.empty()`) ; pas de raccourci clavier
  par défaut ; ressources libérées (`registerEvent`, `addCommand`…) ; pas de style en ligne (classes CSS + variables
  Obsidian) ; titres de réglages via `setHeading()` et sans le mot « Settings » ; casse de phrase partout ;
  `Vault.process` et `processFrontMatter` plutôt que `modify` ; `normalizePath` sur les chemins construits.
- **Soumission** : elle passe désormais par **community.obsidian.md** (compte Obsidian + GitHub lié), avec revue
  **automatique** et retours dans l'annuaire. Le `manifest.json` de la branche par défaut fait foi. Faite par le
  mainteneur (P4).
- → **`id: "refinr"`** (libre au 2026-11-13 ; plugins voisins existants : `refine`, `ai-refiner`) et
  **`name: "Refinr"`**. Description provisoire (mainteneur) : « Turn the active note into an agent-ready backlog
  (Epics, Stories, Sub-tasks) in Jira or OpenProject, via Refinr. » (finalisée en P4). Pas de `fundingUrl`.

### Licence
- **MIT** (décision du mainteneur, 2026-11-13) : le plugin est un client de l'API REST et ne contient aucun code de
  Refinr (AGPL-3.0-only). MIT est la norme du catalogue et maximise l'adoption. En-têtes SPDX
  `SPDX-License-Identifier: MIT` dès P1. Pas de CLA.

### Ajustements reportés dans le plan (P1–P4)
- P1 : `minAppVersion 1.13.0` (relevée en P1, cf. section P1), `isDesktopOnly false` (`true` pour la 0.1.0, cf. P4), `id refinr`, `obsidian` épinglé, TypeScript 5.x, lint
  `eslint-plugin-obsidianmd`, en-têtes SPDX MIT, `LICENSE` MIT ; clé d'API via `SecretComponent`/`SecretStorage` (plus de
  « champ masqué » dans `data.json`) ; réglage « taille max envoyée » remplacé par `maxContentChars` lu sur `/source` ;
  délais d'attente côté plugin ; client HTTP sur `requestUrl` avec `throw: false`, testé via un transport injecté.
- P2 : frontmatter retiré via `getFrontMatterInfo().contentStart` ; expansion pure (cache et résolveur injectés),
  embeds non Markdown laissés tels quels ; contrôle local de `maxContentChars` (titre compris).
- P3 : délai dépassé sur `create-jira` → état inconnu, sans relance.
- P4 : README avec déclaration réseau, stockage de la clé et configuration de Refinr pour un accès autre que
  `localhost` (`REFINR_ALLOWED_HOSTS`, et `CORS_ALLOWED_ORIGINS` si nécessaire) ; essai réel incluant la liste ci-dessous ; soumission via
  community.obsidian.md.

### À confirmer à l'exécution (essai réel P4)
1. `requestUrl` sur mobile (iOS, Android), y compris vers un Refinr en `http://` sur le réseau local
   (`REFINR_ALLOWED_HOSTS` renseigné) ; en-tête `Origin` envoyé ou non **sur mobile**, sans 403 CORS.
   *Desktop : confirmé en P1 (macOS, aucun `Origin`, cf. « Essai réel P1 »).*
2. `SecretStorage` : disponibilité sur mobile, comportement avec Obsidian Sync, emplacement exact de la valeur.
   *Desktop : valeur absente des fichiers du coffre et persistance après redémarrage confirmées en P1.*
3. `SecretComponent` : changement et suppression de secret dans les réglages. *Création et sélection : confirmées en P1.*
4. `processFrontMatter` : mise en page, commentaires et ordre des clés préservés ; erreur claire sur un YAML invalide.
5. `embeds` : fraîcheur du cache juste après une modification (protection `stale-cache` non déclenchée en essai).
   *Code en bloc et en ligne, bloc `^id` d'élément de liste : observés en P2 (cf. « Essai réel P2 »).*
6. Rendu de la fenêtre d'aperçu sur mobile et en thème clair/sombre. *Desktop : observé en P2.*
7. Délai dépassé côté plugin : notice correcte, aucune relance de `create-jira`.

## Phase P1 — Squelette, réglages, connexion

### Outillage
- **Gabarit officiel** `obsidian-sample-plugin@07ceb81` (0BSD) : `esbuild.config.mjs`, `eslint.config.mts`,
  `tsconfig.json`, `version-bump.mjs`, `.editorconfig`, `.npmrc` repris ; bannière du bundle avec l'en-tête SPDX MIT ;
  code d'exemple et `AGENTS.md` non repris.
- **Versions exactes** (`--save-exact`, vérifiées sur npm le 2026-11-13) : `obsidian` 1.14.4 (au lieu de `latest`),
  `typescript` 5.9.3 (dernière 5.x, décision P0), `esbuild` 0.28.2, `eslint` / `@eslint/js` 9.39.5, `typescript-eslint`
  8.72.2, `eslint-plugin-obsidianmd` 0.5.1, `globals` 17.14.0, `jiti` 2.7.0, `@types/node` 22.20.5, `vitest` 5.1.0.
- **ESLint 9, pas 10** : version du gabarit ; `eslint-plugin-obsidianmd` embarque `eslint-plugin-import`, non suivi sur
  ESLint 10. La règle `noUnsupportedApi` de ce plugin vérifie qu'aucune API utilisée n'exige plus que `minAppVersion`.
- **Vitest 5** (demandé par le mainteneur) : seule devDependency ajoutée au gabarit ; impose Node `^22.12 || ^24`
  → `engines.node >=22.12.0`, `.nvmrc` 24, CI sur Node 22 et 24 (Node 20, présent dans le gabarit, est en fin de vie).
- **Aucune dépendance d'exécution** : tout est en devDependencies, le bundle ne contient que notre code.
- **`postinstall` d'esbuild non exécuté** (npm 11 : `allowScripts`) : sans effet, le binaire de la plateforme est
  installé par les dépendances optionnelles (`npx esbuild --version` → 0.28.2).
- **CI** (`.github/workflows/ci.yml`, actions épinglées par SHA comme dans `refinr`) : lint + build + tests (Node 22,
  24), en-têtes SPDX, gitleaks 8.30.1 (CLI officielle, somme de contrôle vérifiée — empreinte écrite en dur depuis P4 —, historique complet), absence
  d'attribution IA dans les messages des commits poussés (`scripts/check-ai-attribution.sh`, même motif que le hook).
  Le workflow de release du gabarit est reporté à P4 (cf. « Phase P4 — Release »).
- **Hooks versionnés** repris de `refinr` (`pre-commit` gitleaks + SPDX, `commit-msg` anti-attribution) ;
  `scripts/check-spdx.sh` attend `SPDX-License-Identifier: MIT` sur `*.ts|mts|mjs|cjs|js|css`, hooks, scripts, YAML
  GitHub.
- **`minAppVersion` 1.13.0 et réglages déclaratifs** (décision du mainteneur) : la règle
  `obsidianmd/settings-tab/prefer-setting-definitions` demande l'API déclarative (`getSettingDefinitions`, réglages
  rendus par Obsidian et trouvables par la recherche des réglages), apparue en 1.13.0, et la configuration recommandée
  interdit de la désactiver. → `minAppVersion` passe de 1.11.4 à **1.13.0** (`manifest.json`, `versions.json`) et
  l'onglet est entièrement déclaratif (plus de `display()`, déprécié depuis 1.13.0) : **lint à 0 avertissement**.
  Le contrôle déclaratif `secret` (`SettingSecretControl`) n'existe qu'à partir de 1.13.2 : la clé est rendue par une
  définition `render` avec `SecretComponent` (1.11.1). Validation en ligne par `validate` (`urlError`,
  `integerError`, testés) ; `setControlValue` repasse chaque changement par `normalizeSettings` avant
  `saveSettings`.
- **Minuteurs `window.setTimeout`** (règle `prefer-window-timers`, compatibilité avec les fenêtres détachées) ; sous
  Vitest, `tests/setup.ts` fait de `window` l'objet global.

### Code et réglages
- **Interface en anglais** (casse de phrase) : langue du catalogue et du README ; une traduction pourra venir plus tard.
- **Client isolé** : `HttpTransport` injecté (tests sans Obsidian), `requestUrl` dans un seul module ; erreurs typées
  `network`, `timeout`, `unauthorized`, `host-not-allowed` (403 JSON « Host not allowed »), `cors` (403 texte
  « Invalid CORS request »), `too-large`, `http`, `invalid-response` ; message `error` et `correlationId` de Refinr
  repris ; la clé est masquée dans tout détail d'erreur.
- **« Test connection »** : `GET /health` (exempté de clé chez Refinr), puis `/source` et `/tracker` (soumis à la clé :
  ce sont eux qui prouvent qu'elle est acceptée) ; délai 30 s par appel ; si Refinr est injoignable, on n'insiste pas.
- **Délai d'analyse par défaut : 1 560 s (26 min)**, calculé sur le code de Refinr avec ses réglages par défaut :
  un délai dépassé n'est jamais relancé, les nouveaux essais ne suivent que des échecs rapides (429, 5xx, injoignable :
  2 au plus, attente plafonnée à 30 s), et une sortie hors schéma est relancée 2 fois (`max-repair-attempts`).
  Un appel structuré coûte donc au plus 3 × (délai + 60 s) : analyse 3 × (300 + 60) = 1 080 s, verdict séparé
  (facultatif, `refinr.llm.verdict.provider`) 3 × (90 + 60) = 450 s par lot de 10 stories (lots séquentiels),
  soit 1 530 s pour un lot, plus 30 s de marge. Au-delà de 10 stories avec verdict séparé, ajouter 450 s par lot :
  réglable de 60 à 7 200 s. Message de délai dépassé : « Refinr may still be analyzing the note… » (analyse),
  « The issues may have been created anyway: check the tracker before trying again. » (création).
- **Inclusions** : profondeur max 3 (bornes 0–10), 100 000 caractères ajoutés au plus (bornes 0–1 000 000), soit la
  moitié de la limite par défaut de Refinr pour garder la place de la note elle-même ; la limite effective reste
  `maxContentChars` (P2).
- **`data.json`** : `refinrUrl`, `apiKeySecret` (nom du secret), `defaultProjectKey`, `embedMaxDepth`, `embedMaxChars`,
  `analysisTimeoutSeconds` ; relu par `normalizeSettings` (types et bornes), aucune valeur de clé.

### Essai réel P1 (2026-11-13, macOS, Obsidian 1.13.4, coffre de test `~/dev/doc-to-jira/refinr-obsidian-test-vault`)
- Plugin compilé copié dans le coffre ; secret factice `refinr-p1-test` créé via `SecretComponent` (valeur de 21
  caractères, factice).
- **Serveur d'écho** (`127.0.0.1:8099`, journal des en-têtes) : notice « Refinr: connection OK / Refinr is up
  (http://127.0.0.1:8099). / Source: Echo source (notes up to 200,000 characters, title included). / Tracker: Echo
  tracker. ». En-têtes reçus pour `/health`, `/source`, `/tracker` :
  - **aucun en-tête `Origin`** (ni `Referer`) ; `sec-fetch-site: none`, `sec-fetch-mode: no-cors` ;
  - `user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)
    obsidian/1.13.4 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36` ;
  - `x-api-key` présent, **21 caractères** (longueur de la valeur factice), `accept: application/json`.
- **Refinr local** (`localhost:8080`, clé d'API désactivée, `CORS_ALLOWED_ORIGINS` par défaut) : notice « Refinr:
  connection problem / Refinr answers but is degraded: unavailable service(s): jira. / Source: Confluence (notes up to
  200,000 characters, title included). / Tracker: Jira. » — **pas de 403 CORS** ; Jira DOWN pour une raison sans
  rapport (jeton révoqué ; log backend `Jira health check failed: HTTP 404`). Aucun rejet CORS ni d'hôte dans les
  logs du backend pendant l'essai (seule ligne CORS : `CORS allowed origins: [http://localhost:3000]` au démarrage).
- **Après Cmd+Q et relance** : même notice, secret toujours trouvé → **persistance confirmée** sur desktop.
- L'essai a été fait avec l'onglet de réglages impératif (`display()`), avant le passage à l'API déclarative ; le
  client HTTP et la commande sont inchangés depuis. Rendu de l'onglet déclaratif : à revoir lors de l'essai de P2.
- **Conclusion CORS (desktop)** : `requestUrl` n'envoie pas d'`Origin` → le filtre CORS de Refinr ne s'applique pas,
  aucune configuration `CORS_ALLOWED_ORIGINS` n'est nécessaire sur desktop. Aucune évolution de Refinr requise. Le
  message d'erreur `cors` et la ligne du README restent pour le mobile (non vérifié).
- **Stockage du secret** :
  - fichiers du coffre : valeur **absente** (`grep -r`) ; seul le **nom** `refinr-p1-test` figure dans
    `.obsidian/plugins/refinr/data.json` ;
  - profil Obsidian (`~/Library/Application Support/obsidian`, 124 fichiers, recherche UTF-8 et UTF-16) : valeur
    **absente en clair** ; le `Local Storage` ne contient que des métadonnées, clé `<id du coffre>-secrets-meta` →
    `{"refinr-p1-test":{"lastAccess":…}}` ;
  - la documentation dit « local storage » ; l'observation montre que la valeur n'y est pas en clair. Elle est
    vraisemblablement chiffrée ou confiée au trousseau du système (Electron `safeStorage`), **non vérifié** : la
    lecture du trousseau macOS n'a pas été faite. → Texte neutre retenu (cf. section P0 « Clé d'API ») ; emplacement
    exact à vérifier en P4 (point 2 de la liste).

## Phase P2 — Aperçu

### Texte envoyé
- **Commande « Analyze note »** (`analyze-note`, anglais US, disponible seulement sur une note Markdown active) :
  lecture de la note (`vault.read`, pas le cache, pour les dernières modifications enregistrées), frontmatter retiré
  (`getFrontMatterInfo().contentStart`), inclusions développées, puis `GET /source` (limite fraîche), contrôle local de
  la taille, `POST /api/v1/analyze-preview` avec `{content, title}` (`title` = nom de la note). Une analyse à la fois
  par note. Rien n'est créé dans le tracker.
- **Limite de taille exacte** (lue dans le code de Refinr, `DocumentAnalysis.providedText`) : Refinr compte
  `"# " + titre + "\n\n" + contenu` (titre aux espaces regroupés et rognés ; contenu seul si titre vide) en **code
  points**. `src/document.ts` refait exactement ce calcul (espaces au sens Java `\s`, ASCII seulement) ; au-delà de
  `maxContentChars`, rien n'est envoyé et la fenêtre donne les deux tailles. Le 413 reste traité.
- **Expansion des inclusions** (`src/embeds.ts`, pure, 27 tests) : offsets de `metadataCache` (`embeds`), cible par
  `getFirstLinkpathDest`, section par `resolveSubpath` ; `![[#Titre]]` = même note ; frontmatter des notes incluses
  retiré ; non-Markdown (images, PDF, canvas) et cibles ou sections absentes laissés tels quels ; liens externes
  (`scheme://`) laissés tels quels sans avertissement ; embeds situés dans un bloc de code (sections `code`) ignorés ;
  boucle = même partie déjà en cours d'expansion, ou note entière dont une partie l'est ; profondeur 0 = aucune
  expansion, sans avertissement ; une inclusion qui ferait dépasser `embedMaxChars` (cumul, inclusions imbriquées
  comptées une fois) est écartée entière, avec le nombre de caractères écartés.
- **Cache périmé** : si le texte aux offsets du cache ne correspond plus à l'inclusion (`original`), la note est
  envoyée sans expansion avec un avertissement, plutôt que coupée au mauvais endroit. Cache absent (note pas encore
  indexée) : même conduite.
- **Avertissements visibles** (demande du mainteneur) : tout avertissement change le texte envoyé ; ils sont affichés
  en tête de l'aperçu (et pendant le chargement, et sur une erreur) dans un encadré, avec le total des caractères
  écartés.

### Aperçu
- **Texte brut uniquement** (demande du mainteneur) : tout texte issu de Refinr (donc du modèle) est inséré par
  `createEl({ text })` / `setText`, jamais via HTML ni `MarkdownRenderer`. Vérifié par `tests/plain-text.test.ts`
  (aucune source n'emploie `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `MarkdownRenderer`,
  `sanitizeHTMLToDom`, `DOMParser`, `createContextualFragment`), par le lint (`no-unsanitized`) et par l'essai réel.
- **`raw` conservé** : le tableau `epics` est gardé tel que reçu pour être renvoyé à `create-jira` en P3, sans perte
  des champs que le plugin n'affiche pas.
- **Fenêtre** (`Modal`) : chargement (taille envoyée, limite), erreur (message de l'API via `describeError`),
  résultat : totaux, épics, stories repliables (`details`) avec badge de verdict (`ai-ready`,
  `validation-necessaire`, `no verdict`), points, « As … I want … so that … », critères, sous-tâches (heures). Styles
  par classes et variables d'Obsidian. Fenêtre fermée pendant l'analyse : l'analyse continue, une notice « preview
  ready » propose « Open preview » (résultat en mémoire seulement).
- **Dependabot** (`.github/dependabot.yml`) : npm et GitHub Actions, hebdomadaire, mineures et correctifs groupés ;
  majeures ignorées pour `typescript` (5.x), `eslint` et `@eslint/js` (9) et `@types/node` (Node 22 minimum).

### Essai réel P2 (2026-11-13, macOS, Obsidian 1.15.1, coffre de test, notes `P2/`)
- **Onglet de réglages déclaratif** : rendu correct ; la recherche des réglages trouve « Maximum embed depth » et
  « Maximum embedded characters » ; URL sans schéma → « Enter an http:// or https:// URL. » ; valeurs gardées après
  réouverture ; texte de la clé et délai 1 560 s affichés. Profondeur 99 : c'est la **validation native** du champ
  nombre d'Obsidian (`min`/`max`) qui s'affiche, notre message `integerError` n'apparaît pas ; `abc` ne peut pas être
  saisi (champ nombre). Valeurs hors bornes jamais enregistrées (en plus, `setControlValue` repasse par
  `normalizeSettings`).
- **Texte réellement envoyé** (serveur d'écho, corps journalisé, 718 caractères + 13 pour `# Spec main\n\n` = 731,
  comme affiché) : frontmatter de la note et de la note incluse retirés ✓ ; section `#Scope` avec son sous-titre,
  arrêtée avant « Out of scope » ✓ ; bloc de paragraphe `^vat` ✓ ; boucle A → B → A arrêtée sur `![[Loop A]]` dans
  `Loop B` ✓ ; `![md](Part-md.md)` (inclusion au format Markdown) développée ✓ ; cible absente et image laissées
  telles quelles ✓ ; `Huge appendix` (124 000 caractères) écartée, « 123,999 characters left out » ✓ ;
  `![[…]]` dans un **bloc de code** et dans du **code en ligne** laissés tels quels ✓ (le cache d'Obsidian ne les
  compte pas comme inclusions, ou notre filtre les écarte) ; `[[lien]]` simple intact ✓. En-têtes : pas d'`Origin`,
  `content-type: application/json`, `x-api-key` présent.
- **Écart constaté — bloc d'élément de liste** : `![[Sections#^item]]` (identifiant sur un élément qui a un
  sous-élément) n'envoie que sa ligne, `- second item with child ^item` ; le sous-élément est perdu, sans
  avertissement (`resolveSubpath` donne la plage de l'élément seul). **Point ouvert**, cf. fin de section.
- **Texte brut** : `<b>bold?</b>`, `<img src=x onerror="alert(1)">`, `**markdown?**`, `[[link?]]` affichés
  littéralement (titre et description d'épic, titre de story) ; aucun rendu HTML, aucune alerte ✓. Trois badges de
  verdict et les points affichés ✓.
- **Refinr local** (`google / gemini-3.6-flash`) : chargement puis fenêtre fermée ; notice « Refinr: the preview of
  Spec main is ready. » en moins de 2 min, « Open preview » rouvre l'aperçu : 1 épic, 1 story `ai-ready` (3 pts),
  2 sous-tâches ; la description reprend le contenu des inclusions (commandes payées, numéro, date, montant, commandes
  annulées exclues) ✓.
- Cache périmé : non testé (facultatif).

### Décisions après l'essai P2 (mainteneur)
- **`integerError` gardé comme filet de sécurité** : rarement visible sur desktop (validation native du champ nombre),
  couvre décimaux et mobile.
- **Bloc d'élément de liste : sous-éléments inclus** (`extendListBlock`, `src/embeds.ts`, appelée par l'adaptateur
  quand `resolveSubpath` renvoie un bloc avec `list`) : la plage va jusqu'au `position.end` du dernier descendant,
  à tous les niveaux ; un élément est descendant si sa chaîne de `parent` (`cache.listItems`) remonte à la ligne de
  l'élément ciblé ; les frères suivants et le reste de la liste sont exclus. Garde supplémentaire : on s'arrête au
  premier élément suivant qui n'est pas plus indenté que la cible (`position.start.col`), car un élément racine d'une
  liste commençant à la ligne 0 a `parent` = -0 = 0, la même valeur que « enfant de la ligne 0 ». Les sous-éléments
  passent par la même expansion (profondeur, taille, boucles). Bloc sur un paragraphe ou un titre : inchangé.
  Tests : enfants sur deux niveaux, sans enfant, dernier élément, élément suivi d'un frère, sous-élément contenant une
  inclusion, liste numérotée, liste de tâches, élément imbriqué ciblé, paragraphe, ambiguïté de la ligne 0 (contrôle :
  fonction neutralisée → 8 tests en échec).
- **Correctif après le second essai** : le premier build échouait sur toute la note (« Could not read the note:
  Cannot read properties of null (reading 'position') »). Cause : dans le vrai cache, `resolveSubpath` renvoie
  **`list: null`** pour un bloc de paragraphe (`^vat`), et non `undefined` ; le code lisait `list.position`. Les
  fixtures de test ne produisaient jamais ce `null`. → Conversion isolée dans `subpathRange`
  (`src/obsidian/subpath.ts`, pure, jamais d'exception) : `list` nul ou absent = bloc ordinaire ; `listItems` absent,
  ligne introuvable, éléments `null` ou mal formés → la ligne seule, avec l'avertissement `list-incomplete` dans
  l'encadré ; l'analyse continue. Test de non-régression sur les objets **réels** du cache de `P2/Sections.md`
  (capturés par un `console.log` temporaire, retiré ensuite ; lignes à partir de 0, racine `parent: -12`,
  sous-élément `parent: 13`, `list` = l'objet de `listItems` qui porte `id: "item"`).
- **Essai réel du correctif** (Obsidian 1.15.1) : aperçu affiché sans erreur, 4 problèmes d'inclusion ; texte reçu par
  le serveur d'écho pour la section « List item block » :
  `- second item with child ^item` puis `  - child of second item` ; 743 caractères de contenu + 13 de titre = 756
  affichés (731 avant + 25 pour le sous-élément).

## Phase P3 — Création, frontmatter, réévaluation

### Faits vérifiés dans le code de Refinr (lecture seule, 2026-11-13)
- **`POST /api/v1/create-jira?projectKey=…`** (`BacklogController.createJira`) :
  - corps : **liste d'`EpicDto`** (`List<EpicDto>`), c'est-à-dire le tableau `epics` de l'aperçu tel quel (champs
    inconnus ignorés). `aiReady` / `aiReadyReason` envoyés sont **ignorés** : le verdict est **recalculé** sur le contenu
    final (`CreateEditedBacklogService` → `StoryVerdicts.apply`), donc par un appel au modèle (fournisseur du verdict, ou
    celui de l'analyse s'il n'y en a pas). Le verdict d'une story créée peut donc différer de celui de l'aperçu.
  - `projectKey` facultatif (vide = projet par défaut du tracker) ; invalide pour le tracker actif → **400**
    `{"success":false,"error":"Invalid projectKey: X"}`.
  - réponse (`creationResponse`) : **200** tout créé (`success: true`, `message: "Successfully created N issues"`),
    **207** partiel (`success: false`, `message: "Partially created: N issues created, M not created"`), **502** rien
    créé (`success: false`, `error: "No issue could be created"`) ; dans les trois cas : `created`, `failed`, `epics`.
    Autre exception → **500** `{"error":"Failed to create the issues"}` (sans listes).
  - `created[]` : `{type: "epic"|"story"|"subtask", title, key, url}` (`url` null si inconnue), dans l'ordre de
    création. `failed[]` : `{type, title, reason}` ; `reason` = message sûr de l'adaptateur (`IssueTrackerException`),
    `"Unexpected error"` pour une autre erreur, ou `"Not created: parent epic|story <titre> failed"` pour les enfants
    d'un parent en échec (ils sont listés aussi).
  - `epics[]` : le backlog avec `jiraKey` (clé du ticket créé, null si non créé) et, par story, le **verdict recalculé**
    `aiReady` / `aiReadyReason`. `jiraUrl` des stories **n'est pas rempli** à la création (`CreateBacklogService` ne pose
    que la clé) : l'URL d'une story se lit dans `created[]` par sa **clé**.
  - → Lien story ↔ verdict ↔ URL pour le frontmatter : `epics[].stories[]` (titre, `jiraKey`, `aiReady`,
    `aiReadyReason`) joint à `created[]` par `key` (URL). Les titres ne servent pas de clé de jointure (doublons
    possibles).
  - Création jamais relancée par Refinr (POST non idempotent) ; un second envoi du même aperçu recrée tout.
- **`POST /api/v1/reassess-story`** (`BacklogController.reassessStory`, `ReassessStoryService`) :
  - corps `{issueKey, precision}` (deux chaînes non vides, sinon **400** `"issueKey and precision are required"`).
  - réponse **200** `{success: true, issueKey, aiReady: boolean, aiReadyReason: string}` (nouveau verdict).
  - côté tracker : la précision et le nouveau verdict sont ajoutés (OpenProject : **commentaire** + champ liste du
    verdict ; Jira : ajout en fin de description + remplacement du label de verdict). Une réévaluation relancée
    ajoute donc un second commentaire.
  - **409** `"Issue KEY is not awaiting validation (label validation-necessaire absent)"` si la story n'a plus le
    verdict `validation-necessaire` dans le tracker.
  - **Pas de 404** : une clé inconnue fait échouer `findStory` (exception générique de l'adaptateur), attrapée par le
    contrôleur → **500** `"Failed to reassess the story"` (cause dans les logs, `correlationId`). Modèle : **502**
    (`"The AI model did not produce a valid result, even after retries"`, `"... output was truncated ..."`,
    `"The AI provider is unavailable"`).
- **Durées** : la réévaluation fait un appel « verdict » (90 s par défaut avec un fournisseur de verdict, sinon le
  fournisseur et le délai de l'analyse, 300 s) avec relances et réparations, puis les appels au tracker ; la création
  fait le recalcul des verdicts (lots de 10 stories, séquentiels) puis un appel au tracker par ticket. → Les deux
  utilisent le délai d'analyse du plugin (`analysisTimeoutSeconds`, 1 560 s) et la même logique de fenêtre et de
  notice que l'analyse. Délai dépassé : création → « état inconnu, vérifier le tracker », jamais de relance ;
  réévaluation → « Refinr may still be reassessing… vérifier le tracker avant de relancer » (une relance ajoute un
  second commentaire).

### Vérifications demandées après le plan (mainteneur)
- **Un 502 peut-il contenir des éléments créés ?** Non : `creationResponse` ne répond 502 que si `created` est vide
  (créé ≥ 1 et échec ≥ 1 → 207). Le plugin ne s'appuie pas sur le code HTTP : il lit `created[]` dès que le corps
  contient les listes (200, 207, 502) et écrit le frontmatter **dès que `created[]` n'est pas vide** (`partial` si
  `failed[]` n'est pas vide) ; rien n'est écrit seulement si `created[]` est vide.
- **Contrôle du tracker avant réévaluation** : Refinr n'expose pas l'adresse de son tracker (`GET /tracker` = nom
  seul ; les URL de tickets n'arrivent que dans la réponse de création). Comparer l'hôte de l'URL d'une story du
  frontmatter à « celui des URL que renvoie Refinr » n'est donc pas possible sans appel de création. → Comparaison
  par **nom affiché** seulement. **Limite** : deux instances du même tracker (deux OpenProject, deux Jira) ne sont pas
  distinguées ; une réévaluation pourrait viser une clé de l'autre instance (au pire 409 ou 500, aucun ticket créé).

### Décisions P3
- **Création** : bouton « Create in {tracker} » (nom lu sur `GET /tracker` pendant l'analyse ; inconnu → pas de
  bouton) ; confirmation dans la fenêtre (projet modifiable, prérempli par `defaultProjectKey`, nombres,
  recalcul du verdict annoncé, avertissement si la note a déjà un `refinr`) ; un seul clic (l'état change avant
  l'envoi) ; délai `analysisTimeoutSeconds`, notice « Open result » si la fenêtre est fermée. Résultat : tickets
  créés (lien seulement pour une URL `http(s)://`), verdict recalculé (et « preview: … » s'il diffère, pour les
  titres uniques), `failed` avec `type`, `title`, `reason` tels quels.
- **« Rien créé » seulement si c'est certain** (`nothingCreated`) : requête partie en échec avant l'envoi (erreurs
  Chromium `ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED`, `ERR_ADDRESS_UNREACHABLE`, `ERR_INTERNET_DISCONNECTED`,
  `ERR_CERT_*`, `ERR_SSL_*`…, ou Node `ECONNREFUSED`, `ENOTFOUND`…) ou refus de Refinr avant création (400 projet
  invalide, 401, 403 hôte/CORS, 413). Tout le reste — délai, coupure après l'envoi (`ERR_CONNECTION_RESET`,
  `ERR_EMPTY_RESPONSE`…), message réseau non reconnu (mobile), 5xx sans listes, réponse illisible — est **inconnu** :
  `status: unknown` écrit et message « check the tracker before trying again ». `requestUrl` ne donne que le message
  d'erreur : un message inconnu est traité comme le cas prudent.
- **Frontmatter `refinr`** (schéma du plan) : `created` (date locale ISO 8601 avec décalage, `moment().format()`),
  `tracker`, `project` (null = défaut), `status` (`complete` | `partial` | `unknown`), `epics[] {title,key,url}`,
  `stories[] {title,key,url,verdict[,reassessed]}`, `failed[] {type,title,reason}`, `history[]`. Une nouvelle
  création confirmée déplace l'ancien bloc dans `history` : **liste plate**, ordre chronologique, l'`history` de
  l'ancien bloc remonté au même niveau, une valeur `refinr` non conforme gardée telle quelle (test d'une troisième
  création). Écriture par `processFrontMatter` uniquement ; note supprimée ou YAML invalide → rien d'écrit, bouton
  « Copy as YAML » (`stringifyYaml`).
- **Exclusivité** : un verrou par note (`create` | `reassess`) ; « Reassess a story » est indisponible pendant une
  création sur la note, la création est refusée pendant une réévaluation : jamais deux `processFrontMatter`
  concurrents sur le même bloc.
- **Réévaluation** : commande « Reassess a story » (note active avec au moins une story `validation-necessaire` dans
  `refinr.stories`, bloc courant seulement) → choix → précision (obligatoire) → `reassess-story` → `verdict` et
  `reassessed` mis à jour (rien d'autre). Messages : 409 « KEY is no longer awaiting validation in {tracker}; the note
  was not updated. » (aucune cause supposée : la story a pu être réévaluée ailleurs, par exemple depuis l'interface web
  de Refinr) ; 500 « Refinr could not reassess KEY (issue missing in {tracker}, or {tracker} unavailable) » + message
  et `correlationId` ; délai « Refinr may still be reassessing… (a new attempt adds another comment) ».

### Essai réel P3 (2026-11-13, Obsidian 1.15.1, Refinr local sur l'OpenProject local) — partiel
- « Test connection » → « Tracker: OpenProject » ✓.
- Aperçu de `P3/Order export spec` : 1 epic, 1 story `validation-necessaire`, 3 sous-tâches ; confirmation conforme
  (projet, nombres, rappel du recalcul) ✓.
- Création : « Created 5 issue(s) » ; la story #147 est **recalculée `ai-ready`** avec la mention « (preview:
  validation-necessaire) » ✓ (confirme que le verdict de création peut différer de l'aperçu).
- Frontmatter conforme au schéma ; `tags`, `status`, `aliases` intacts ✓. Le panneau Propriétés affiche `refinr` en
  JSON (propriété objet).
- « Reassess a story » masquée quand aucune story n'est en attente ✓.
- Un 502 à l'analyse (modèle) est affiché proprement, avec le `correlationId` ✓.
- **Non testé** (Gemini en 502, quota probablement épuisé) : deuxième création (`history`), réévaluation. **À la
  main** (mainteneur) : modification d'une autre propriété depuis le panneau Propriétés. Pour la réévaluation, note
  `P3/Customer data export (open points)` ajoutée au coffre de test : points ouverts explicites (format, encodage,
  droits, contenu, livraison), pour un verdict `validation-necessaire` même après recalcul.
- La fixture `P2/Spec main.md`, écrasée par erreur pendant l'essai, a été recréée à l'identique.

### Reprise de l'essai réel P3 (2026-11-13)
- Seconde création sur `P3/Order export spec` : avertissement « This note already has a Refinr backlog » (date,
  tracker, nombre de stories, statut ; rien d'écrasé) ✓, puis « Create again » : 4 tickets, story #152
  `validation-necessaire` ✓. `refinr.history` **à plat**, une seule entrée (l'ancienne création #146/#147) ✓ ;
  `tags`, `status`, `aliases` intacts ✓.
- « Reassess a story » visible seulement quand une story est en attente ; ne propose que #152 (pas les stories de
  `history`) ✓. Fenêtre de précision et état « reassessing… » ✓.
- Réévaluation en **502** (Gemini, `correlationId` 387b2d56-…) : message affiché proprement, frontmatter inchangé ✓.
- **Non testé** (Gemini instable) : réévaluation réussie (`verdict`, `reassessed`) et 409. Panneau Propriétés : à
  la main (mainteneur).
- **502 et commentaire** (vérifié dans le code de Refinr) : un 502 de `reassess-story` vient uniquement de
  `LlmFailures.translate`, qui n'enveloppe que l'appel au modèle, fait **avant** `applyReassessment` → **aucun
  commentaire** n'est ajouté ; le message du 502 n'en parle pas (test). En revanche, un **500** peut survenir **après**
  le commentaire sur OpenProject (commentaire, puis `PATCH` du verdict en échec) ; sur Jira, un seul `PUT`. → Le
  message du 500 dit désormais : « If the issue exists, the precision may already have been added as a comment: check
  it before trying again (a new attempt adds another comment). »
- **409 validé** : #152 passé en `ai-ready` dans OpenProject, puis réévaluation depuis Obsidian → « 152 is no longer
  awaiting validation in OpenProject; the note was not updated. » ; frontmatter inchangé sur le disque ✓.

### Réévaluation réussie (fin de l'essai réel P3, 2026-11-13, modèle Gemini 3.8)
- **Obsidian** : « New verdict: ai-ready » avec la raison de Refinr, puis « Verdict of 152 updated » ✓.
- **Frontmatter** (`P3/Order export spec`) : story #152 → `verdict: ai-ready`,
  `reassessed: 2026-11-13T23:50:05+01:00` ; le reste du bloc `refinr` (`created`, `tracker`, `project`, `status`,
  `epics`, `failed`) et `history` intacts ✓, ainsi que `tags`, `status`, `aliases`.
- **OpenProject** : champ verdict à `ai-ready`, **un seul** commentaire de précision ✓. Les deux réévaluations en 502
  précédentes n'en avaient laissé aucun ✓ (confirme l'analyse du code : un 502 vient de l'appel au modèle, fait avant
  `applyReassessment`).
- **Non observé** : le retrait de `verdictSource` par une réévaluation réussie. #152 a été créée avant le correctif du
  verdict de repli, son bloc n'a jamais porté `verdictSource`. Couvert par le test « a reassessment replaces a
  fallback verdict: verdictSource removed » (`tests/backlog-record.test.ts`).
- **Reste à la main** (mainteneur) : modification d'une autre propriété depuis le panneau Propriétés.
- **Constat côté Refinr** : la **description** de #152 garde l'ancienne ligne « verdict indisponible (no verdict) :
  validation humaine necessaire ». Vérifié dans le code de Refinr (`724624b`, lecture seule) : sur OpenProject,
  `applyReassessment` ajoute précision et nouveau verdict **en commentaire** et ne touche pas la description ; sur
  Jira, ils sont ajoutés **à la fin** de la description, sous l'ancienne ligne, qui reste. Le verdict à jour est
  celui du champ (OpenProject) ou du label (Jira). Signalé dans
  [chams-bensalem/refinr#32](https://github.com/chams-bensalem/refinr/issues/32). Aucun changement côté plugin.

### Verdict de repli (écart trouvé à la seconde création)
- **Constat** : le recalcul du verdict a buté sur le quota du modèle ; dans OpenProject, #152 porte « verdict
  indisponible (no verdict) : validation humaine necessaire », mais le plugin affichait et écrivait
  `validation-necessaire` comme un verdict normal.
- **Vérifié dans Refinr** : aucun drapeau dans le contrat. Le repli est `ReadinessPolicy.unavailable(cause)` →
  `aiReady: false` et `aiReadyReason` = `verdict indisponible (<cause>) : validation humaine necessaire` (seul
  appelant : `StoryVerdicts`, à l'analyse comme à la création ; la réévaluation ne fait pas de repli, elle répond 502).
  Ce texte arrive dans `epics[].stories[].aiReadyReason`.
- **Décision** : repérage sur ce **libellé exact** (`src/verdict.ts`, expression ancrée, testée) :
  - aperçu : badge « no verdict » (compté dans « without verdict ») au lieu de `validation-necessaire` ;
  - résultat de création : « no verdict » + « AI unavailable, human validation required » ;
  - frontmatter : `verdict: validation-necessaire` (ce qui est dans le tracker) **et `verdictSource: fallback`** ;
    la story reste proposée à la réévaluation, et une réévaluation réussie retire `verdictSource`.
- **Limite** : ce repérage dépend du libellé de Refinr, pas d'un contrat ; si le texte change, le repli redevient un
  `validation-necessaire` ordinaire (jamais un faux `ai-ready`). **À proposer côté Refinr** (aucune issue « 429 »
  trouvée : ouvertes #28 et #29 seulement) : exposer dans le contrat qu'un verdict est un repli, par exemple
  `"aiReadySource": "model" | "fallback"` (ou `aiReady: null` + raison) sur chaque story de `analyze-preview` et de
  `create-jira`, pour que les clients n'aient pas à analyser un texte.
- **Issue Refinr ouverte** (non traitée dans cette phase) :
  [chams-bensalem/refinr#32](https://github.com/chams-bensalem/refinr/issues/32) « Expose LLM unavailability in the
  REST contract (rate limits and fallback verdicts) » — 429 du fournisseur → 503 explicite + `Retry-After` ;
  `"aiReadySource": "model" | "fallback"` par story dans `analyze-preview` et `create-jira`. Quand elle sera livrée,
  le plugin lira `aiReadySource` et gardera le repérage par libellé pour les versions plus anciennes de Refinr.

## Phase P4 — Release

### Format attendu par le catalogue (sources consultées le 2026-11-13)
Sources : `obsidianmd/obsidian-developer-docs` commit `1c26772` (2026-10-21) — *Submit your plugin*, *Release your
plugin with GitHub Actions*, *Reference/Versions*, *Reference/Manifest* ; gabarit `obsidianmd/obsidian-sample-plugin`
commit `07ceb81` (2026-08-02) — README « Releasing new releases », `.github/workflows/release.yml`,
`version-bump.mjs`, `package.json`.
- **Tag = version exacte** : « The "Tag version" of the release must match the version in your `manifest.json` » ;
  versions au seul format `x.y.z` (*Manifest*, *Submit*) ; gabarit : « Use the exact version number, don't include a
  prefix `v` ». À l'installation, Obsidian télécharge les fichiers de la release « whose tag matches the `version` in
  your manifest ». → tag `0.1.0`, jamais `v0.1.0`.
- **Fichiers joints** : `main.js`, `manifest.json`, `styles.css` (« optional »), en pièces jointes binaires ;
  `manifest.json` doit être **à la fois** à la racine du dépôt (la branche par défaut fait foi pour le catalogue) et
  dans la release. → les trois fichiers sont joints (`styles.css` existe et est versionné).
- **`versions.json`** (*Reference/Versions*) : objet « version du plugin → `minAppVersion` », lu **à la racine du
  dépôt** quand l'application est plus ancienne que le `minAppVersion` du manifest, pour proposer la dernière version
  compatible. La doc précise qu'il suffit de le mettre à jour quand `minAppVersion` change ; le `version-bump.mjs` du
  gabarit ajoute pourtant une entrée à chaque version. → on suit le gabarit (une entrée par version), ce qui permet un
  contrôle simple et sans ambiguïté au moment de la release.
- **Release en brouillon** : le workflow de la doc et celui du gabarit créent un **draft** (`gh release create --draft`),
  publié ensuite à la main. → même chose ; le mainteneur relit et publie. Notes générées par GitHub
  (`--generate-notes` : PR fusionnées depuis la release précédente), retouchées avant publication.
- **Attestation de provenance** : la doc et le gabarit ajoutent `actions/attest@v4` (« recommended when you submit a
  plugin »). ~~Non reprise (`contents: write` seul)~~ → **reprise** (décision du mainteneur, 2026-11-13) sur `main.js`,
  `manifest.json` et `styles.css`, comme dans la doc officielle.
  - Version : `actions/attest` **v4.2.2** (dernière v4, 2026-08-04), épinglée par SHA
    `1e69f48acb82d1966a394da916b4c1698aa569d6` (commit du tag, vérifié par l'API GitHub).
  - Permissions (README de l'action, v4.2.2) : `id-token: write` (jeton OIDC pour le certificat de signature
    Sigstore) et `attestations: write` (enregistrement de l'attestation). La troisième permission citée,
    `artifact-metadata: write`, ne sert qu'aux « storage records », créés seulement avec `push-to-registry: true`
    (images OCI) et pour des dépôts d'organisation → inutile ici, non demandée.
  - **Limite : dépôt privé.** « To use artifact attestations in private or internal repositories, you must be on a
    GitHub Enterprise Cloud plan » (README de l'action). Le dépôt `refinr-obsidian` est **privé** au 2026-11-13 :
    tant qu'il l'est (sans Enterprise Cloud), l'étape d'attestation échouera et aucune release ne sera créée. Le dépôt
    doit de toute façon être public pour le catalogue ; le changement de visibilité reste une décision du mainteneur.
  - Vérification par un utilisateur : `gh attestation verify main.js --repo chams-bensalem/refinr-obsidian`.

### Workflow `.github/workflows/release.yml`
- **Déclencheur** : push d'un tag `'[0-9]+.[0-9]+.[0-9]+'` (motif de filtre GitHub) ; un tag `v0.1.0` ne déclenche rien.
- **Deux jobs** (décision du mainteneur, 2026-11-13, après une revue de sécurité automatique du premier workflow à un
  seul job) : avec `id-token: write` sur un job, **toutes** ses étapes reçoivent de quoi obtenir un jeton OIDC
  (`ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN`), y compris `npm ci`, le lint, les tests et le build, qui exécutent les
  devDependencies et le code du dépôt.
  - **`build`** (`contents: read`) : checkout `fetch-depth: 0` et `persist-credentials: false`, contrôle « tag sur
    `main` », contrôle des versions (avant l'installation : échec rapide), `npm ci --ignore-scripts --no-audit
    --no-fund`, lint, tests, build (Node de `.nvmrc`, 24), puis envoi de `main.js`, `manifest.json`, `styles.css`
    (`actions/upload-artifact` **v7.0.2**, SHA `cf430e030ddbb5b0abf93d22962f4752f3646cd9`, `if-no-files-found: error`,
    `retention-days: 1`).
  - **`release`** (`needs: build` ; `contents: write` pour la release et ses fichiers, `id-token: write` pour le
    certificat Sigstore, `attestations: write` pour enregistrer l'attestation, chacune commentée) : **ni checkout, ni
    npm, ni code du dépôt**. `actions/download-artifact` **v8.0.2** (SHA `9000827ccba6bdab643e8b6fd33ac0654aef8333` ;
    empreinte de l'artefact vérifiée par défaut, `digest-mismatch: error`), contrôle que les trois fichiers sont
    présents et non vides (taille et SHA-256 affichés dans le journal), attestation, puis `gh release create "$TAG"
    --repo "$GITHUB_REPOSITORY" --verify-tag --draft --title "$TAG" --generate-notes` avec les trois fichiers.
  - `permissions: {}` au niveau du workflow. Tag passé par `env` (`TAG`), jamais interpolé dans un script. Actions
    épinglées par SHA (checkout et setup-node aux mêmes versions que `ci.yml`), mises à jour par Dependabot
    (`github-actions`). `concurrency` par tag, sans annulation.
- **Ce que la séparation protège** : le jeton OIDC (donc la capacité de signer une attestation au nom du dépôt) et le
  droit d'écriture (`contents: write` : releases, tags, contenu du dépôt) sont **hors de portée de tout code exécuté au
  build** — devDependencies, scripts npm, tests, configuration esbuild/ESLint. Le job `build` n'a qu'un jeton en
  lecture, non conservé dans `.git/config`. Le job `release` n'exécute que des actions épinglées et `gh`.
- **Ce qu'elle ne protège pas** : un outil de build compromis (esbuild, TypeScript, un plugin ESLint…) qui modifierait
  `main.js` pendant le build. Le fichier modifié serait transmis, attesté et publié comme un fichier légitime :
  l'attestation prouve **où et à partir de quel commit** le fichier a été construit, pas que la chaîne d'outils était
  saine. Ce risque n'est couvert que par le lockfile (`package-lock.json`, versions exactes et empreintes
  d'intégrité), `npm ci` (installation strictement conforme au lockfile), `--ignore-scripts` (aucun script
  d'installation exécuté) et Dependabot (mises à jour relues par PR), ainsi que par la relecture du brouillon avant
  publication.
- **`--ignore-scripts`** : sans effet sur le build (le binaire d'esbuild vient de sa dépendance optionnelle de
  plateforme ; son `postinstall` n'était déjà pas exécuté, cf. P1). Vérifié localement : `npm ci --ignore-scripts`
  puis `npm run build` réussit.
- **Contrôle des versions** (`node version-bump.mjs check <tag>`) : tag au format `x.y.z` ; `manifest.json`
  `version` = tag ; `package.json` `version` = tag (gardé par décision du mainteneur : `npm version` les garde
  alignés, un écart signale une édition à la main) ; `versions.json[tag]` présent et égal au `minAppVersion` du
  manifest. Tous les écarts sont listés, avec la commande qui les corrige.
- **Le commit du tag doit être dans l'historique de `main`** (décision du mainteneur, 2026-11-13) : `actions/checkout`
  avec `fetch-depth: 0` (historique complet et branches distantes, donc `origin/main`), puis
  `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`. Pour un push de tag, `GITHUB_SHA` est le commit visé
  (aussi pour un tag annoté). Échec avec un message `::error::` (commit refusé, marche à suivre) ; échec explicite aussi
  si `origin/main` manque. Ainsi seul du code relu et fusionné par PR est publié ; le README pose le tag sur `main`
  après la fusion.
- **actionlint** (v1.7.12, image Docker `rhysd/actionlint`, lancé hors du dépôt, 2026-11-13, sur la version à un job
  puis sur la version à deux jobs) : aucune erreur sur `release.yml` ni `ci.yml` (« Found 0 errors in 2 files »),
  blocs `run:` compris (shellcheck 0.11.0 de l'image).
- **actionlint dans `ci.yml`** (décision du mainteneur, 2026-11-13) : job dédié `workflows`, nom affiché
  **`actionlint`** (nom exact du check à rendre obligatoire dans le ruleset de `main`, mis à jour par le mainteneur),
  `permissions: contents: read`, checkout `persist-credentials: false`. **Binaire officiel** v1.7.12
  (`actionlint_1.7.12_linux_amd64.tar.gz`), somme vérifiée contre `actionlint_1.7.12_checksums.txt` de la même release,
  extrait dans `$RUNNER_TEMP` (hors du dépôt), comme le job gitleaks : aucune action tierce. Préféré à l'image Docker
  (épinglage par digest possible, mais un `docker run` de plus et une image à suivre à la main). shellcheck, utilisé
  pour les blocs `run:`, est préinstallé sur `ubuntu-latest` (0.9.0, image runner Ubuntu 24.04 `20261111.370.1`).
  Version mise à jour à la main (Dependabot ne suit pas une variable d'environnement). Job reproduit dans un conteneur
  `ubuntu:24.04` amd64 : somme « OK », « Found 0 errors in 2 files ».
- **Empreintes SHA-256 écrites en dur dans `ci.yml`** (décision du mainteneur, 2026-11-13), pour actionlint et
  gitleaks, au lieu de les lire dans le `checksums.txt` téléchargé : un fichier de sommes pris à la même source que
  l'archive ne protège que contre un téléchargement corrompu, pas contre une release remplacée. Variables
  `ACTIONLINT_SHA256` et `GITLEAKS_SHA256`, vérifiées par `echo "<sha256>  <archive>" | sha256sum -c -`.
  - actionlint 1.7.12 `linux_amd64` : `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8` ;
    gitleaks 8.30.1 `linux_x64` : `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`. Relevées dans
    les `checksums.txt` officiels et recoupées par `sha256sum` des archives téléchargées (identiques).
  - **Mise à jour** (commentaire au-dessus de chaque variable) : changer la version, copier la ligne de l'archive
    depuis `<outil>_<version>_checksums.txt` de la release, la recouper avec `sha256sum` de l'archive téléchargée.
    Toujours à la main : Dependabot ne suit ni ces versions ni ces empreintes.

### `npm version` et `version-bump.mjs`
- Le script `"version"` du gabarit existait déjà (`node version-bump.mjs && git add manifest.json versions.json`) :
  gardé. `version-bump.mjs` est complété : refus d'une version autre que `x.y.z` (sans rien écrire), refus d'un
  manifest sans `minAppVersion`, saut de ligne final conservé (le gabarit l'enlevait), et sous-commande
  `check <tag>` utilisée par le workflow.
- **Contrôle dans `version-bump.mjs` plutôt que dans un script séparé** : un nouveau `scripts/*.mjs` serait analysé par
  ESLint avec les règles Obsidian et le service de projet TypeScript (erreur « not found by the project service ») ;
  `version-bump.mjs` est déjà exclu du lint par la configuration du gabarit. Un seul fichier porte ainsi la règle des
  versions (expression `x.y.z` unique).
- **`.npmrc`** : `tag-version-prefix=""` (déjà présent, gabarit) et **`git-tag-version=false`** (ajouté) : `npm
  version` ne crée ni commit ni tag. Le changement de version passe par une PR (jamais de push sur `main`) et le tag est
  posé ensuite sur `main`. Vérifié dans une copie jetable : `npm version 0.1.1` met à jour `package.json`,
  `manifest.json`, `versions.json` (`"0.1.1": "1.13.0"`), aucun tag ni commit créé.
- **Tests** (`tests/release-version.test.ts`) : le script est lancé comme par npm et par le workflow (processus Node
  dans un dossier temporaire) ; cas nominal, `minAppVersion` relevé, entrée existante, versions refusées, écarts
  listés, JSON illisible, sous-commande inconnue, et cohérence des fichiers du dépôt pour leur propre version.

### Procédure (résumé, détail dans le README, section « Releasing »)
1. Branche : `minAppVersion` à la main si besoin, `npm version <x.y.z>`, commit `chore: release <x.y.z>`, PR.
2. Fusion de la PR sur `main`.
3. Première version seulement : dépôt passé en **public** par le mainteneur (sinon l'attestation échoue).
4. Sur `main` : `git tag -a <x.y.z> -m <x.y.z>` puis `git push origin <x.y.z>` ; le workflow crée le brouillon.
5. Le mainteneur relit puis publie le brouillon.
6. Première version seulement : soumission sur community.obsidian.md (cf. P0, « Soumission »).
- Pour recommencer : `gh release delete <x.y.z> --cleanup-tag --yes` (brouillon et tag distant ; sans brouillon,
  `git push origin :refs/tags/<x.y.z>`), `git tag -d <x.y.z>`, correction, puis nouveau tag sur `main`.

## Dépendances

### Alerte Dependabot n°1 : minimatch (2026-11-14)
- **Avis** : [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (CVE-2026-118764), gravité
  **modérée**, CWE-405, publié le 2026-10-30, mis à jour le 2026-11-04. « Potential denial of service via globparts
  amplification » : avec `optimizationLevel >= 2`, la transformation `**/../` de `firstPhasePreProcess()` clone des
  entrées de `globParts` dans une boucle jusqu'au point fixe, puis `secondPhasePreProcess()` les compare deux à deux
  (quadratique). Un **motif glob fourni par un attaquant** peut ainsi consommer beaucoup de CPU et de mémoire.
- **Versions** : vulnérables `>= 7.0.0, < 11.0.1` ; corrigée à partir de **11.0.1** (commit `77a0f5c`, 2026-10-27).
  **Aucun correctif en 9.x ni en 10.x** : dernières versions 9.0.9 (2026-02-26) et 10.2.6 (2026-07-27), toutes deux
  vulnérables (vérifié sur npm et dans l'avis global). Le plan initial (override dans les majeures `^9.0.5` et
  `^10.2.2`) était donc impossible.
- **Portée** : dépendance de **développement** uniquement (`dev: true` dans le lockfile), deux copies vulnérables :
  `9.0.9` via `eslint-plugin-obsidianmd` → `@microsoft/eslint-plugin-sdl` → `eslint-plugin-n@17.10.3` (`^9.0.5`), et
  `10.2.6` via `typescript-eslint` → `@typescript-eslint/typescript-estree@8.72.2` (`^10.2.2`, encore dans sa dernière
  version). `3.1.5` (ESLint, `eslint-plugin-import`, `eslint-plugin-react`) est hors de la plage. **Absent de
  `main.js`** : aucune occurrence de `minimatch`, `globParts`, `firstPhasePreProcess` dans le bundle de production ;
  métafichier esbuild : 17 entrées, toutes dans `src/`, aucune dans `node_modules`. Exposition réelle faible : les
  deux paquets n'appellent que `minimatch(...)` / `new Minimatch(...)` sur des motifs écrits par nous
  (`allowDefaultProject`, configuration ESLint).
- **Refusé** : la rétrogradation proposée de `eslint-plugin-obsidianmd` vers 0.0.2 (dernière version : 0.5.1, sur
  laquelle reposent les règles du catalogue).
- **Décision** (mainteneur) : `overrides` dans `package.json`, limité aux deux parents, vers **`^11.0.1`** (résolu en
  11.0.8) :
  `"eslint-plugin-n": { "minimatch": "^11.0.1" }` et `"@typescript-eslint/typescript-estree": { "minimatch":
  "^11.0.1" }`. C'est une majeure de plus que les plages déclarées par ces paquets ; la 11.0 casse l'API (retrait de
  `makeRe()`, `Minimatch#regexp`, `AST` ; appariement des chemins finissant par `/`), mais les deux paquets n'utilisent
  que l'API conservée.
- **Effet de bord constaté** : npm applique aussi l'override à `eslint` (peer-dépendance d'`eslint-plugin-n`, résolue
  dans son sous-arbre), donc à `eslint`, `@eslint/config-array` et `@eslint/eslintrc`, qui passent de 3.1.5 à 11.0.8.
  Seules `eslint-plugin-import` et `eslint-plugin-react` gardent 3.1.5. **Vérifié sans régression** par comparaison
  avec `main` (`90e5964`, lockfile d'origine, clone jetable) : mêmes **32 fichiers** analysés, 0 problème des deux
  côtés, et configuration résolue (`eslint --print-config`) **identique** pour `src/main.ts`, `manifest.json` et
  `tests/verdict.test.ts` (chemin racine normalisé). `npm ls minimatch` : 7 chemins, versions 11.0.8 et 3.1.5, aucune
  dans la plage vulnérable ; `npm audit` : « found 0 vulnerabilities ».
- **Retrait de l'override** : dès que `eslint-plugin-obsidianmd` (via `@microsoft/eslint-plugin-sdl` /
  `eslint-plugin-n`) et `typescript-eslint` embarqueront une version corrigée de minimatch, supprimer `overrides` et
  régénérer le lockfile (`npm install`, puis `npm ls minimatch`). Dependabot le signalera (mise à jour de ces paquets,
  ou alerte rouverte si l'override est retiré trop tôt). Si un lint se met à se comporter bizarrement entre-temps,
  soupçonner d'abord cet override (ESLint 9 tourne avec une minimatch plus récente que celle qu'il déclare).
