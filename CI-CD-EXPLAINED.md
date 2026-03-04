# Explication complète du pipeline CI/CD

> Projet : **Next.js 15 + Cypress 14** — déployé sur un VPS via SSH + PM2

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Les deux fichiers de workflow](#2-les-deux-fichiers-de-workflow)
3. [ci.yml — Pipeline CI (branche `devlop`)](#3-ciyml--pipeline-ci-branche-devlop)
   - [Déclencheur et permissions](#31-déclencheur-et-permissions)
   - [Job 1 — Build](#32-job-1--build)
   - [Job 2 — Component Tests](#33-job-2--component-tests)
   - [Job 3 — E2E Tests (matrice de navigateurs)](#34-job-3--e2e-tests-matrice-de-navigateurs)
   - [Job 4 — Open PR](#35-job-4--open-pr)
4. [deploy.yml — Pipeline Deploy (branche `main`)](#4-deployyml--pipeline-deploy-branche-main)
5. [Le flux bout-en-bout](#5-le-flux-bout-en-bout)
6. [Les mécanismes clés expliqués](#6-les-mécanismes-clés-expliqués)
   - [Cache](#61-cache)
   - [Artefacts](#62-artefacts)
   - [Matrice de navigateurs](#63-matrice-de-navigateurs)
   - [Parallélisme et `needs`](#64-parallélisme-et-needs)
   - [Secrets](#65-secrets)
7. [Ce que fait chaque commande npm](#7-ce-que-fait-chaque-commande-npm)

---

## 1. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────┐
│  BRANCHE devlop                                                      │
│                                                                      │
│  git push devlop                                                     │
│       │                                                              │
│       ▼  (ci.yml se déclenche)                                       │
│                                                                      │
│  ┌─────────┐   ┌──────────────────┐   ┌────────────────────────┐    │
│  │  Build  │   │ Component Tests  │   │  E2E Tests (chrome)    │    │
│  │         │   │                  │   │  E2E Tests (edge)      │    │
│  │ npm ci  │   │ cypress --compo- │   │  E2E Tests (firefox)   │    │
│  │ npm run │   │ nent             │   │  (en parallèle)        │    │
│  │ build   │   │                  │   │                        │    │
│  └─────────┘   └──────────────────┘   └────────────────────────┘    │
│       │                │                          │                  │
│       └────────────────┴──────────────────────────┘                 │
│                        │ (tous les 4 jobs verts)                     │
│                        ▼                                             │
│                  ┌───────────┐                                       │
│                  │  Open PR  │  → crée une PR devlop → main          │
│                  └───────────┘     automatiquement                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  BRANCHE main (après merge de la PR)                                 │
│                                                                      │
│  git push main (ou merge PR)                                         │
│       │                                                              │
│       ▼  (deploy.yml se déclenche)                                   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  Deploy to VPS                                              │     │
│  │                                                             │     │
│  │  SSH → cd /var/www/cours-ci-cd                             │     │
│  │      → git pull origin main                                │     │
│  │      → npm ci --omit=dev                                   │     │
│  │      → npm run build                                       │     │
│  │      → pm2 restart cours-ci-cd --update-env               │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

**Résumé en une phrase** : chaque push sur `devlop` lance les tests automatiquement ; si tout est vert, une PR vers `main` est créée ; quand cette PR est mergée, le code est automatiquement déployé sur le VPS de production.

---

## 2. Les deux fichiers de workflow

| Fichier | Se déclenche sur | Rôle |
|---------|-----------------|------|
| `.github/workflows/ci.yml` | Push sur `devlop` | Vérifier que le code fonctionne |
| `.github/workflows/deploy.yml` | Push sur `main` | Déployer le code en production |

---

## 3. `ci.yml` — Pipeline CI (branche `devlop`)

### 3.1 Déclencheur et permissions

```yaml
name: CI — Develop

on:
  push:
    branches: [devlop]      # ← Se déclenche UNIQUEMENT sur la branche devlop

permissions:
  contents: read            # ← Peut lire le dépôt (checkout)
  pull-requests: write      # ← Peut créer/modifier des PR (nécessaire pour open-pr)
```

**Pourquoi `permissions` ?**
Par défaut, le `GITHUB_TOKEN` (le token automatique créé par GitHub pour chaque run) a des droits larges. La bonne pratique est de limiter au strict minimum :
- `contents: read` → pour faire `git checkout`
- `pull-requests: write` → pour que le job `open-pr` puisse appeler `gh pr create`

Si on enlève `pull-requests: write`, le job `open-pr` échouerait avec une erreur 403.

---

### 3.2 Job 1 — Build

```yaml
build:
  name: Build
  runs-on: ubuntu-latest      # ← Machine virtuelle Ubuntu fournie par GitHub
  timeout-minutes: 10         # ← Si le job tourne plus de 10 min → il est tué

  steps:
    - uses: actions/checkout@v4
    # Télécharge le code du dépôt sur le runner. Sans ça, le runner
    # est une machine vide sans aucun fichier.

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 20       # ← Version LTS de Node.js utilisée
        cache: npm             # ← Active le cache npm automatique
    # actions/setup-node installe Node 20 ET gère un cache pour ~/.npm
    # La clé du cache est calculée à partir de package-lock.json.
    # Si package-lock.json n'a pas changé depuis le dernier run → cache HIT
    # → npm ci s'exécute en ~8s au lieu de ~60s.

    - name: Install dependencies
      run: npm ci
    # npm ci (clean install) :
    #   - Supprime node_modules et le recrée à partir de package-lock.json
    #   - Garantit que tout le monde a exactement les mêmes versions
    #   - Contrairement à npm install, ne modifie PAS package-lock.json
    #   - Échoue si package-lock.json est absent ou incohérent avec package.json

    - name: Build
      run: npm run build
    # Exécute "next build" (défini dans package.json)
    # Compile TypeScript, optimise les assets, génère le dossier .next/
    # Si le build échoue ici (erreur TS, import manquant...) → job rouge
```

**Rôle de ce job** : s'assurer que le code compile. Si ce job échoue, inutile de lancer les tests.

**Note** : dans ce pipeline, `build`, `component-tests` et `e2e-tests` sont **indépendants** (aucun `needs`), donc ils démarrent **en parallèle** sur 3 runners distincts. Chacun installe ses propres dépendances.

---

### 3.3 Job 2 — Component Tests

```yaml
component-tests:
  name: Component Tests
  runs-on: ubuntu-latest
  timeout-minutes: 10

  steps:
    - uses: actions/checkout@v4

    - name: Cache Cypress binary
      uses: actions/cache@v4
      with:
        path: ~/.cache/Cypress
        # Le binaire Cypress (~150 MB) est téléchargé séparément de node_modules.
        # Il est stocké dans ~/.cache/Cypress sur le runner.

        key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
        # Clé exacte : "cypress-Linux-abc123def456"
        # hashFiles() calcule un hash SHA256 du fichier package-lock.json.
        # Si Cypress change de version → le lockfile change → hash différent
        # → cache invalidé → Cypress re-téléchargé.

        restore-keys: cypress-${{ runner.os }}-
        # Clé de fallback partielle.
        # Si aucune clé exacte trouvée, restaure le cache le plus récent
        # qui commence par "cypress-Linux-".
        # Évite de tout re-télécharger en cas de minor update.

    - name: Cypress component tests
      uses: cypress-io/github-action@v6
      with:
        component: true
    # L'action officielle Cypress fait automatiquement :
    #   1. npm ci (installe les deps si pas encore fait)
    #   2. Lance "cypress run --component"
    # Les tests de COMPOSANTS montent chaque composant React dans un
    # vrai navigateur Chromium SANS démarrer le serveur Next.js.
    # Fichiers testés : tout ce qui correspond au pattern *.cy.tsx

    - name: Upload screenshots si échec
      uses: actions/upload-artifact@v4
      if: failure()
      # "if: failure()" → cette étape ne s'exécute QUE si une étape
      # précédente du job a échoué. Si les tests passent, cette étape
      # est sautée (pas de screenshot uploadé = moins de stockage utilisé).
      with:
        name: component-screenshots
        path: cypress/screenshots/
        # Cypress prend automatiquement un screenshot quand un test échoue.
        # Le fichier est sauvegardé dans cypress/screenshots/
        retention-days: 3
        # L'artefact est supprimé automatiquement après 3 jours.

    - name: Upload vidéos
      uses: actions/upload-artifact@v4
      if: always()
      # "if: always()" → s'exécute TOUJOURS, que le job réussisse ou échoue.
      # Utile pour visionner le déroulement d'un test même réussi
      # (debug de flaky tests = tests instables qui passent parfois).
      with:
        name: component-videos
        path: cypress/videos/
        # Cypress enregistre une vidéo de CHAQUE test (succès et échec).
        retention-days: 3
```

**Différence tests de composants vs E2E :**

| | Component Tests | E2E Tests |
|---|---|---|
| Serveur Next.js | Non démarré | Démarré (`npm start`) |
| Ce qu'on teste | Un composant React isolé | Un flux utilisateur complet |
| Vitesse | Rapide (~30s) | Lent (~2-5 min) |
| Fichiers testés | `*.cy.tsx` dans `components/` | `*.cy.ts` dans `cypress/e2e/` |

---

### 3.4 Job 3 — E2E Tests (matrice de navigateurs)

```yaml
e2e-tests:
  name: E2E Tests (${{ matrix.browser }})
  # Le titre du job dans l'UI GitHub sera :
  #   "E2E Tests (chrome)"
  #   "E2E Tests (edge)"
  #   "E2E Tests (firefox)"

  runs-on: ubuntu-latest
  timeout-minutes: 15         # Plus long que les component tests car le serveur doit démarrer

  strategy:
    fail-fast: false
    # Par défaut (fail-fast: true) : si chrome échoue, les jobs edge et
    # firefox sont annulés immédiatement pour économiser les ressources.
    # Ici on veut TOUJOURS voir les résultats des 3 browsers même si l'un
    # échoue → on obtient un rapport complet "ça marche sur chrome et edge
    # mais pas firefox → problème Gecko".

    matrix:
      browser: [chrome, edge, firefox]
    # GitHub Actions crée automatiquement 3 jobs distincts et les lance
    # EN PARALLÈLE sur 3 runners différents :
    #
    #   Runner 1 ─── e2e-tests (chrome)
    #   Runner 2 ─── e2e-tests (edge)
    #   Runner 3 ─── e2e-tests (firefox)
    #
    # Chaque runner est une machine Ubuntu indépendante.

  steps:
    - uses: actions/checkout@v4

    - name: Cache Cypress binary
      uses: actions/cache@v4
      with:
        path: ~/.cache/Cypress
        key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
        restore-keys: cypress-${{ runner.os }}-
    # Même cache que les component tests.
    # Comme les 3 runners ont le même OS (ubuntu-latest) et le même
    # package-lock.json, ils partagent la même clé de cache → le binaire
    # Cypress est restauré pour les 3 sans re-téléchargement.

    - name: Install Firefox (non-snap) pour ubuntu-latest
      if: matrix.browser == 'firefox'
      # Cette étape ne s'exécute QUE sur le runner "firefox".
      # Sur ubuntu-latest (Ubuntu 22.04+), Firefox est installé via snap
      # par défaut. Cypress ne peut pas interagir avec Firefox en snap
      # (problème de sandboxing). On installe donc la version apt classique.
      run: |
        sudo apt-get update -qq
        sudo apt-get install -y firefox

    - name: Cypress E2E tests (${{ matrix.browser }})
      uses: cypress-io/github-action@v6
      with:
        build: npm run build
        # Lance "next build" AVANT de démarrer le serveur.
        # Nécessaire pour "npm start" qui sert le build de production.

        start: npm start
        # Lance "next start" → démarre le serveur Next.js en production
        # sur http://localhost:3000

        wait-on: http://localhost:3000
        # Cypress attend que cette URL réponde avant de lancer les tests.
        # Sans ça, Cypress démarrerait alors que le serveur n'est pas prêt
        # → tous les tests échoueraient avec "connection refused".

        wait-on-timeout: 60
        # Temps maximum d'attente : 60 secondes.
        # Si le serveur ne répond pas en 60s → le job échoue.

        browser: ${{ matrix.browser }}
        # Passe "chrome", "edge" ou "firefox" à Cypress selon le job.
        # Cypress lance le navigateur correspondant pour tous les tests.

    - name: Upload screenshots si échec
      uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: e2e-screenshots-${{ matrix.browser }}
        # ← IMPORTANT : le nom inclut le navigateur.
        # Sans ça, les 3 jobs tenteraient d'uploader un artefact nommé
        # "e2e-screenshots" → collision → erreur 409 sur le 2e et 3e upload.
        # Avec le suffixe : e2e-screenshots-chrome, e2e-screenshots-edge,
        # e2e-screenshots-firefox → 3 artefacts distincts.
        path: cypress/screenshots/
        retention-days: 7

    - name: Upload vidéos
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: e2e-videos-${{ matrix.browser }}
        path: cypress/videos/
        retention-days: 7
```

**Ce que génère la matrice dans l'UI GitHub :**

```
Actions Run #42
├── Jobs
│   ├── ✅ Build
│   ├── ✅ Component Tests
│   ├── ✅ E2E Tests (chrome)
│   ├── ✅ E2E Tests (edge)
│   └── ❌ E2E Tests (firefox)    ← Seulement Firefox a un problème
│
└── Artifacts
    ├── e2e-screenshots-firefox.zip  ← Automatiquement uploadé (failure)
    ├── e2e-videos-chrome.zip        ← Toujours uploadé (always)
    ├── e2e-videos-edge.zip
    └── e2e-videos-firefox.zip
```

---

### 3.5 Job 4 — Open PR

```yaml
open-pr:
  name: Open PR → main
  needs: [build, component-tests, e2e-tests]
  # ← Ce job attend que les 3 autres soient TOUS verts avant de démarrer.
  # Si build ou component-tests ou n'importe lequel des 3 e2e-tests échoue
  # → open-pr ne s'exécute pas → pas de PR créée → le code ne peut pas
  # partir en production.

  runs-on: ubuntu-latest

  steps:
    - uses: actions/checkout@v4

    - name: Créer la PR si elle n'existe pas
      continue-on-error: true
      # Si cette étape échoue (ex: token expiré, quota GitHub API)
      # le job reste vert quand même. On ne veut pas bloquer le CI
      # à cause d'une PR qui n'a pas pu être créée.
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # GITHUB_TOKEN est un secret automatiquement fourni par GitHub
        # pour chaque run. Il n'a pas besoin d'être configuré manuellement.
        # Il est utilisé par la CLI gh pour s'authentifier.
      run: |
        EXISTING=$(gh pr list --base main --head devlop --state open --json number --jq '.[0].number')
        # gh pr list : liste les PR ouvertes
        # --base main : dont la branche de destination est main
        # --head devlop : dont la branche source est devlop
        # --state open : uniquement les PR ouvertes (pas fermées/mergées)
        # --json number : output en JSON, ne garder que le champ "number"
        # --jq '.[0].number' : extraire le numéro de la première PR
        # Résultat : soit un numéro ("42") soit une chaîne vide ("")

        if [ -z "$EXISTING" ]; then
          # -z teste si la variable est vide
          # Si vide → aucune PR existante → on en crée une
          gh pr create \
            --base main \
            --head devlop \
            --title "chore: merge devlop → main" \
            --body "Tous les tests sont passés ✅ — PR créée automatiquement après le CI."
          echo "PR créée."
        else
          echo "PR #$EXISTING déjà ouverte, rien à faire."
          # Une PR existe déjà → on ne fait rien (évite les doublons)
        fi
```

**Pourquoi ce job ?**
- Automatise la création de la PR devlop → main quand les tests passent
- On n'a plus besoin d'aller manuellement sur GitHub créer la PR
- Si une PR existe déjà (ex: push précédent), elle n'est pas recréée

---

## 4. `deploy.yml` — Pipeline Deploy (branche `main`)

```yaml
name: Deploy — Production VPS

on:
  push:
    branches: [main]
    # ← Se déclenche UNIQUEMENT sur la branche main.
    # Donc : push direct sur main OU merge d'une PR vers main.

permissions:
  contents: read
  # Pas besoin de pull-requests: write ici.
  # On lit juste le code pour le checkout.

jobs:
  deploy:
    name: Deploy to VPS
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4
      # Checkout du code sur le runner GitHub.
      # Note : le code n'est pas transféré au VPS depuis ici.
      # Le VPS fait son propre git pull directement.

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        # Action tierce qui se connecte en SSH et exécute des commandes.
        # Elle utilise le module Node.js "ssh2" en interne.
        with:
          host: ${{ secrets.VPS_HOST }}
          # L'adresse IP ou le nom de domaine du VPS.
          # Ex: "123.456.789.0" ou "monserveur.com"

          username: ${{ secrets.VPS_USER }}
          # L'utilisateur SSH sur le VPS. Ex: "ubuntu", "deploy", "root"

          key: ${{ secrets.VPS_SSH_KEY }}
          # La clé SSH privée (format PEM/RSA/Ed25519).
          # La clé publique correspondante doit être dans
          # ~/.ssh/authorized_keys sur le VPS.

          port: ${{ secrets.VPS_PORT }}
          # Par défaut SSH est sur le port 22.
          # Souvent changé pour des raisons de sécurité (ex: 2222).

          script: |
            set -e
            # "set -e" : arrête le script dès qu'une commande échoue.
            # Sans ça, le script continuerait même après une erreur,
            # et le job serait faussement marqué comme réussi.

            cd /var/www/cours-ci-cd
            # Se déplace dans le dossier du projet sur le VPS.
            # Ce dossier doit exister et être un dépôt git cloné.

            echo "→ Pull du code..."
            git pull origin main
            # Récupère les dernières modifications de la branche main.
            # Le VPS doit avoir accès au dépôt GitHub (via HTTPS avec
            # token ou via clé SSH déployée sur le VPS).

            echo "→ Installation des dépendances..."
            npm ci --omit=dev
            # --omit=dev : installe UNIQUEMENT les dépendances de production
            # (pas les devDependencies comme Cypress, TypeScript, etc.)
            # → node_modules plus léger sur le VPS

            echo "→ Build..."
            npm run build
            # Recompile le projet Next.js sur le VPS.
            # Génère un nouveau dossier .next/ optimisé.

            echo "→ Redémarrage de l'application..."
            pm2 restart cours-ci-cd --update-env
            # PM2 est un gestionnaire de processus Node.js pour la prod.
            # "restart" : arrête et redémarre le processus nommé "cours-ci-cd"
            # "--update-env" : recharge les variables d'environnement
            # PM2 garde l'app en vie, la relance si elle crashe, gère les logs.

            echo "✅ Déploiement terminé."
```

**Les 4 secrets SSH à configurer dans GitHub :**

```
GitHub > Settings > Secrets and variables > Actions > New repository secret

VPS_HOST     → IP ou domaine du serveur (ex: 1.2.3.4)
VPS_USER     → Utilisateur SSH (ex: ubuntu)
VPS_SSH_KEY  → Clé privée SSH (contenu du fichier ~/.ssh/id_rsa)
VPS_PORT     → Port SSH (souvent 22 ou 2222)
```

**Prérequis sur le VPS :**
- Git installé et dépôt cloné dans `/var/www/cours-ci-cd`
- Node.js et npm installés
- PM2 installé globalement (`npm install -g pm2`)
- L'app démarrée au moins une fois avec `pm2 start npm --name "cours-ci-cd" -- start`

---

## 5. Le flux bout-en-bout

```
Developer
    │
    │ git push origin devlop
    │
    ▼
GitHub (branche devlop)
    │
    │ ci.yml se déclenche
    │
    ├──────────────────────────────────────────────────────┐
    │                        │                             │
    ▼                        ▼                             ▼
[Build]              [Component Tests]            [E2E Tests - chrome]
 npm ci               Cache Cypress                Cache Cypress
 npm run build        cypress --component          npm run build
                      Upload vidéos                npm start
                      Upload screenshots           wait-on :3000
                      (si failure)                 cypress run chrome
                                                   Upload vidéos
                                                   Upload screenshots
                                                   (si failure)
                                                        │
                                                   [E2E Tests - edge]
                                                   [E2E Tests - firefox]
                                                   (idem, en parallèle)
    │                        │                             │
    └──────────────────┬──────────────────────────────────┘
                       │ tous verts ?
                       ▼
               [Open PR → main]
               gh pr list (vérifie si PR existe)
               gh pr create (si pas encore créée)
                       │
                       ▼
              PR "chore: merge devlop → main"
              visible sur GitHub
                       │
                       │ (merge manuel par le dev)
                       ▼
GitHub (branche main)
    │
    │ deploy.yml se déclenche
    │
    ▼
[Deploy to VPS]
 SSH → VPS
 git pull origin main
 npm ci --omit=dev
 npm run build
 pm2 restart cours-ci-cd
    │
    ▼
🚀 Application en production sur le VPS
```

---

## 6. Les mécanismes clés expliqués

### 6.1 Cache

**Problème sans cache :**
```
Chaque job télécharge node_modules depuis npm → ~60 secondes
Chaque job télécharge le binaire Cypress (~150 MB) → ~40 secondes
Total par job sans cache : ~100 secondes juste pour l'installation
```

**Avec cache :**
```
Run 1 : cache MISS → télécharge tout → sauvegarde le cache sur les serveurs GitHub
Run 2 : cache HIT  → restaure en ~5 secondes
Run 3 : si package-lock.json change → cache MISS → recalcule
```

**Cache npm (géré par `actions/setup-node`) :**
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm
# Équivalent de :
# - uses: actions/cache@v4
#   with:
#     path: ~/.npm         ← Dossier du cache global npm
#     key: node-Linux-abc123   ← Hash de package-lock.json
#     restore-keys: node-Linux-
```

**Cache Cypress (binaire séparé) :**
```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/Cypress     ← Le binaire est ici (pas dans node_modules)
    key: cypress-Linux-abc123  ← Hash de package-lock.json
    restore-keys: cypress-Linux-
```

**Pourquoi deux caches séparés ?**
- `node_modules` : dossier des packages JS (géré par npm)
- `~/.cache/Cypress` : binaire natif Chromium embarqué dans Cypress
  Ces deux choses sont téléchargées séparément lors de `npm ci`.

### 6.2 Artefacts

**Différence cache vs artefact :**

| | Cache | Artefact |
|---|---|---|
| But | Accélérer les prochains runs | Stocker des résultats pour analyse |
| Durée | 7 jours (automatique) | Configurable (`retention-days`) |
| Visible dans l'UI | Non | Oui (onglet "Summary" du run) |
| Partagé entre | Plusieurs runs différents | Jobs du MÊME run |

**Comment accéder aux artefacts :**
1. GitHub → onglet **Actions**
2. Cliquer sur le run concerné
3. Descendre en bas → section **Artifacts**
4. Télécharger le `.zip`

**Les artefacts de ce projet :**

| Artefact | Contenu | Uploadé quand | Durée |
|---|---|---|---|
| `component-screenshots` | Screenshots des tests composants en échec | `if: failure()` | 3 jours |
| `component-videos` | Vidéos de tous les tests composants | `if: always()` | 3 jours |
| `e2e-screenshots-chrome` | Screenshots E2E chrome en échec | `if: failure()` | 7 jours |
| `e2e-screenshots-edge` | Screenshots E2E edge en échec | `if: failure()` | 7 jours |
| `e2e-screenshots-firefox` | Screenshots E2E firefox en échec | `if: failure()` | 7 jours |
| `e2e-videos-chrome` | Vidéos E2E chrome | `if: always()` | 7 jours |
| `e2e-videos-edge` | Vidéos E2E edge | `if: always()` | 7 jours |
| `e2e-videos-firefox` | Vidéos E2E firefox | `if: always()` | 7 jours |

### 6.3 Matrice de navigateurs

```yaml
strategy:
  fail-fast: false
  matrix:
    browser: [chrome, edge, firefox]
```

GitHub Actions génère **un job par valeur** et les exécute en parallèle :

```
job: e2e-tests / browser=chrome   → Runner 1 (ubuntu-latest)
job: e2e-tests / browser=edge     → Runner 2 (ubuntu-latest)
job: e2e-tests / browser=firefox  → Runner 3 (ubuntu-latest)
```

Pour référencer la valeur courante : `${{ matrix.browser }}`

**Pourquoi tester sur 3 navigateurs ?**

```
Chrome  → Moteur Blink  → ~65% des utilisateurs
Edge    → Moteur Blink  → ~4% des utilisateurs  (même moteur que Chrome !)
Firefox → Moteur Gecko  → ~3% des utilisateurs  (moteur différent)
```

Chrome et Edge partagent le même moteur (Blink), mais Edge a ses propres
particularités (scroll behavior, certaines APIs Web). Firefox (Gecko) est
très différent et peut révéler des bugs CSS/JS invisibles sur Chrome.

**Pourquoi installer Firefox manuellement ?**

Ubuntu 22.04 (ubuntu-latest) installe Firefox via **snap** par défaut.
Le snap sandboxe le processus, ce qui empêche Cypress (qui utilise des
pipes unix pour contrôler le navigateur) de fonctionner correctement.
On installe donc la version `apt` (classique, sans sandbox snap) :
```bash
sudo apt-get install -y firefox
```

### 6.4 Parallélisme et `needs`

**Sans `needs` → parallèle (défaut) :**
```yaml
jobs:
  build:           # ──┐
  component-tests: # ──┤── démarrent tous en même temps
  e2e-tests:       # ──┘
```

**Avec `needs` → séquentiel :**
```yaml
jobs:
  open-pr:
    needs: [build, component-tests, e2e-tests]
    # attend que les 3 soient verts
```

**Dans ce projet :**
```
t=0s  ─── build         démarre
t=0s  ─── component-tests démarre
t=0s  ─── e2e (chrome)  démarre
t=0s  ─── e2e (edge)    démarre
t=0s  ─── e2e (firefox) démarre
t=Xs  ─── TOUS verts → open-pr démarre
```

Tous les jobs "lourds" tournent en même temps sur des runners distincts
→ le temps total du CI est le temps du job **le plus lent**, pas la somme.

### 6.5 Secrets

Les secrets sont des variables chiffrées stockées dans GitHub, jamais
visibles en clair dans les logs.

**Se configurent dans :**
`GitHub > repo > Settings > Secrets and variables > Actions`

**Secrets utilisés dans ce projet :**

| Secret | Fichier | Usage |
|---|---|---|
| `GITHUB_TOKEN` | `ci.yml` | Token auto-généré par GitHub, permet d'appeler l'API GitHub (créer des PR) |
| `VPS_HOST` | `deploy.yml` | IP/domaine du VPS |
| `VPS_USER` | `deploy.yml` | Utilisateur SSH |
| `VPS_SSH_KEY` | `deploy.yml` | Clé privée SSH (contenu du fichier `~/.ssh/id_rsa`) |
| `VPS_PORT` | `deploy.yml` | Port SSH |

`GITHUB_TOKEN` est **automatique** : GitHub le crée pour chaque run, pas besoin de le configurer. Les 4 secrets VPS doivent être ajoutés manuellement.

---

## 7. Ce que fait chaque commande npm

Les scripts sont définis dans `package.json` :

```json
{
  "scripts": {
    "dev":               "next dev",
    "build":             "next build",
    "start":             "next start",
    "e2e":               "start-server-and-test dev http://localhost:3000 \"cypress open --e2e\"",
    "e2e:headless":      "start-server-and-test dev http://localhost:3000 \"cypress run --e2e\"",
    "component":         "cypress open --component",
    "component:headless":"cypress run --component"
  }
}
```

| Commande | Utilisée dans | Ce qu'elle fait |
|---|---|---|
| `npm run build` | `ci.yml` (build job) + `deploy.yml` | Compile Next.js → génère `.next/` optimisé |
| `npm run build` | `e2e-tests` (option `build:`) | Build avant de démarrer le serveur pour les tests E2E |
| `npm start` | `e2e-tests` (option `start:`) | Démarre Next.js en mode production sur le port 3000 |
| `npm ci` | Tous les jobs | Installe les dépendances proprement depuis le lockfile |
| `npm ci --omit=dev` | `deploy.yml` | Installe uniquement les deps de prod (pas Cypress, pas TypeScript) |

**Pourquoi `npm ci` et pas `npm install` ?**

| | `npm install` | `npm ci` |
|---|---|---|
| Modifie `package-lock.json` | Oui (si besoin) | **Jamais** |
| Reproductible | Non garanti | Oui (exact même versions) |
| Vitesse avec cache | Similaire | Plus rapide |
| Utilisé en CI | Déconseillé | **Recommandé** |

---

## Récapitulatif visuel final

```
BRANCHE devlop
─────────────────────────────────────────────────────────────────────

Push → ci.yml
         │
         ├── [Build]                      (ubuntu, timeout 10min)
         │     npm ci + npm run build
         │     ↳ vérifie que ça compile
         │
         ├── [Component Tests]            (ubuntu, timeout 10min)
         │     Cache Cypress binary
         │     cypress-io/github-action component:true
         │     ↳ screenshots si failure (3j)
         │     ↳ vidéos toujours (3j)
         │
         └── [E2E Tests] × 3 browsers     (ubuntu, timeout 15min)
               Cache Cypress binary
               Install Firefox si firefox
               cypress-io/github-action
                 build: npm run build
                 start: npm start
                 wait-on: localhost:3000
                 browser: chrome|edge|firefox
               ↳ screenshots si failure (7j)
               ↳ vidéos toujours (7j)

         Tous verts ?
              │
              ▼
         [Open PR → main]
           gh pr create devlop → main
           (si pas déjà ouverte)


BRANCHE main (après merge)
─────────────────────────────────────────────────────────────────────

Push → deploy.yml
         │
         └── [Deploy to VPS]              (ubuntu, timeout 15min)
               appleboy/ssh-action
                 ↳ SSH avec VPS_HOST/USER/KEY/PORT
                 ↳ git pull origin main
                 ↳ npm ci --omit=dev
                 ↳ npm run build
                 ↳ pm2 restart cours-ci-cd --update-env
```
