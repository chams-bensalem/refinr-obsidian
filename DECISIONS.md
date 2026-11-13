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
- → **`isDesktopOnly: false`** : aucune API Node/Electron n'est nécessaire (règle de soumission : Node/Electron ⇒
  `true` obligatoire). Lint et revue vérifieront qu'aucun import Node ne s'y glisse, et qu'il n'y a pas de lookbehind
  dans les regex (non pris en charge sur iOS < 16.4).

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
  Unité : caractères JavaScript (UTF-16), comme `String.length()` côté Java. Écart possible sur les emojis et
  caractères hors BMP, sans conséquence (même unité des deux côtés).

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
- P1 : `minAppVersion 1.13.0` (relevée en P1, cf. section P1), `isDesktopOnly false`, `id refinr`, `obsidian` épinglé, TypeScript 5.x, lint
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
5. `embeds` : `![[…]]` dans du code ignoré ; bloc `^id` d'élément de liste ; note juste modifiée (cache à jour).
6. Rendu de la fenêtre d'aperçu (thèmes clair et sombre, mobile).
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
  24), en-têtes SPDX, gitleaks 8.30.1 (CLI officielle, somme de contrôle vérifiée, historique complet), absence
  d'attribution IA dans les messages des commits poussés (`scripts/check-ai-attribution.sh`, même motif que le hook).
  Le workflow de release du gabarit est reporté à P4.
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
  réglable de 60 à 7 200 s. Message de délai dépassé : « Refinr may still be analysing the note… » (analyse),
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
