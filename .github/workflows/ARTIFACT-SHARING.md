# Partage du build entre jobs via Artefact

> Pattern : construire une seule fois, réutiliser dans plusieurs jobs

---

## Pourquoi ce pattern ?

Dans la configuration par défaut du projet, `npm run build` est lancé
**dans chaque job E2E** (une fois par navigateur) :

```
build job        → npm run build  (1x)
e2e chrome job   → npm run build  (2x)  ← doublon
e2e edge job     → npm run build  (3x)  ← doublon
e2e firefox job  → npm run build  (4x)  ← doublon
```

Avec ce pattern, le build ne tourne **qu'une seule fois** et son résultat
est transmis aux autres jobs via un artefact GitHub Actions.

---

## Comment ça marche

Les jobs GitHub Actions tournent sur des **runners isolés** (machines virtuelles
distinctes). Ils ne partagent aucun fichier système. Pour transférer des fichiers
d'un job à l'autre au sein du même run, on utilise deux actions :

```
actions/upload-artifact   →  sauvegarde des fichiers sur les serveurs GitHub
actions/download-artifact →  restaure ces fichiers sur un autre runner
```

```
┌─────────────────────────────────────────────────────────┐
│  Runner A (job: build)                                   │
│                                                          │
│  npm run build → génère .next/                           │
│  upload-artifact "nextjs-build" ──────────────────────┐  │
└──────────────────────────────────────────────────────────┘  │
                                                          │
                                          Serveurs GitHub │
                                          stockent .next/ │
                                                          │
┌─────────────────────────────────────────┐               │
│  Runner B (job: e2e chrome)             │               │
│                                         │               │
│  download-artifact "nextjs-build" ◄─────┘               │
│  → .next/ disponible ici                │               │
│  npm start (pas de build)               │               │
│  cypress run chrome                     │               │
└─────────────────────────────────────────┘               │
                                                          │
┌─────────────────────────────────────────┐               │
│  Runner C (job: e2e edge)               │               │
│                                         │               │
│  download-artifact "nextjs-build" ◄─────┘               │
│  → même .next/ restauré                 │               │
│  npm start                              │               │
│  cypress run edge                       │               │
└─────────────────────────────────────────┘
```

---

## Le workflow complet

```yaml
name: CI — Develop

on:
  push:
    branches: [devlop]

permissions:
  contents: read
  pull-requests: write

jobs:

  # ─── 1. BUILD ──────────────────────────────────────────────────────
  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        # Compile Next.js → génère le dossier .next/
        # C'est ce dossier qu'on va partager avec les jobs E2E.

      - name: Sauvegarder le build
        uses: actions/upload-artifact@v4
        with:
          name: nextjs-build
          # Nom de l'artefact — c'est ce nom qu'on utilise pour
          # le télécharger dans les autres jobs.
          path: .next/
          # Dossier à sauvegarder. Contient tout le build Next.js :
          # pages compilées, assets optimisés, manifests, etc.
          retention-days: 1
          # L'artefact est supprimé après 1 jour.
          # 1 jour suffit : il n'est utile que pendant ce run.

  # ─── 2. TESTS COMPOSANTS ───────────────────────────────────────────
  component-tests:
    name: Component Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Pas de "needs: build" ici.
    # Les component tests ne démarrent pas de serveur Next.js,
    # ils n'ont pas besoin du build → peuvent tourner en parallèle.
    steps:
      - uses: actions/checkout@v4

      - name: Cache Cypress binary
        uses: actions/cache@v4
        with:
          path: ~/.cache/Cypress
          key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: cypress-${{ runner.os }}-

      - name: Cypress component tests
        uses: cypress-io/github-action@v6
        with:
          component: true

      - name: Upload screenshots si échec
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: component-screenshots
          path: cypress/screenshots/
          retention-days: 3

      - name: Upload vidéos
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: component-videos
          path: cypress/videos/
          retention-days: 3

  # ─── 3. TESTS E2E ──────────────────────────────────────────────────
  e2e-tests:
    name: E2E Tests (${{ matrix.browser }})
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: build
    # ← DIFFÉRENCE CLÉ avec la version sans partage.
    # Ce job attend que "build" soit terminé et vert avant de démarrer.
    # Sans ça, download-artifact échouerait car l'artefact n'existerait
    # pas encore.
    strategy:
      fail-fast: false
      matrix:
        browser: [chrome, edge, firefox]
    steps:
      - uses: actions/checkout@v4

      - name: Cache Cypress binary
        uses: actions/cache@v4
        with:
          path: ~/.cache/Cypress
          key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: cypress-${{ runner.os }}-

      - name: Récupérer le build Next.js
        uses: actions/download-artifact@v4
        with:
          name: nextjs-build
          # Doit correspondre exactement au "name:" dans upload-artifact.
          path: .next/
          # Restaure les fichiers dans .next/ sur ce runner.
          # Après cette étape, le runner a exactement le même .next/
          # que celui produit par le job build.

      - name: Install Firefox (non-snap) pour ubuntu-latest
        if: matrix.browser == 'firefox'
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y firefox

      - name: Cypress E2E tests (${{ matrix.browser }})
        uses: cypress-io/github-action@v6
        with:
          # "build:" est RETIRÉ ici.
          # On ne rebuild pas → on utilise le .next/ téléchargé.
          start: npm start
          # "npm start" = "next start" → sert le build de production déjà présent.
          # next start requiert que .next/ existe → c'est le cas grâce au download.
          wait-on: http://localhost:3000
          wait-on-timeout: 60
          browser: ${{ matrix.browser }}

      - name: Upload screenshots si échec
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-screenshots-${{ matrix.browser }}
          path: cypress/screenshots/
          retention-days: 7

      - name: Upload vidéos
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-videos-${{ matrix.browser }}
          path: cypress/videos/
          retention-days: 7

  # ─── 4. PULL REQUEST AUTOMATIQUE VERS MAIN ─────────────────────────
  open-pr:
    name: Open PR → main
    needs: [build, component-tests, e2e-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Créer la PR si elle n'existe pas
        continue-on-error: true
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          EXISTING=$(gh pr list --base main --head devlop --state open --json number --jq '.[0].number')
          if [ -z "$EXISTING" ]; then
            gh pr create \
              --base main \
              --head devlop \
              --title "chore: merge devlop → main" \
              --body "Tous les tests sont passés ✅ — PR créée automatiquement après le CI."
            echo "PR créée."
          else
            echo "PR #$EXISTING déjà ouverte, rien à faire."
          fi
```

---

## Timeline comparée

### Sans partage (version actuelle)

```
t=0s  ── build           démarre → npm ci + npm run build
t=0s  ── component-tests démarre
t=0s  ── e2e (chrome)    démarre → npm ci + npm run build + cypress
t=0s  ── e2e (edge)      démarre → npm ci + npm run build + cypress
t=0s  ── e2e (firefox)   démarre → npm ci + npm run build + cypress

         build tournant 4 fois en tout
         tous les jobs parallèles dès le départ
```

### Avec partage (ce workflow)

```
t=0s  ── build           démarre → npm ci + npm run build + upload
t=0s  ── component-tests démarre (pas besoin du build)

         (build terminé à t=Xs)

t=Xs  ── e2e (chrome)    démarre → download + npm start + cypress
t=Xs  ── e2e (edge)      démarre → download + npm start + cypress
t=Xs  ── e2e (firefox)   démarre → download + npm start + cypress

         build tournant 1 seule fois
         e2e bloqués jusqu'à la fin de build
```

---

## Avantages et inconvénients

### Avantages

- `npm run build` tourne **une seule fois** au lieu de 3 (ou 4 avec le job `build`)
- Le build est **identique** sur les 3 runners E2E (même binaire, même hash)
- Économie de temps CPU et de minutes GitHub Actions

### Inconvénients

- Les jobs E2E ne démarrent plus à t=0 mais après la fin de `build`
- Si `npm run build` est rapide (< 30s), le gain est quasi nul
- Upload + download de l'artefact `.next/` prend du temps (réseau)

### Quand l'utiliser

```
Build < 30s   → peu d'intérêt, garder la version sans partage
Build 30-60s  → gain marginal, au choix
Build > 60s   → partage recommandé, économie significative
```

---

## Détail des actions utilisées

### `actions/upload-artifact@v4`

Compresse et envoie des fichiers vers le stockage temporaire GitHub.

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: nextjs-build      # Identifiant pour download-artifact
    path: .next/            # Fichiers à uploader (dossier entier)
    retention-days: 1       # Supprimé après N jours
```

- Le contenu est zippé automatiquement avant envoi
- Visible dans l'onglet "Summary" du run GitHub Actions
- Limité à 10 GB par run (larguement suffisant pour un `.next/`)

### `actions/download-artifact@v4`

Restaure un artefact précédemment uploadé dans le même run.

```yaml
- uses: actions/download-artifact@v4
  with:
    name: nextjs-build      # Doit correspondre au name: de upload
    path: .next/            # Où déposer les fichiers sur ce runner
```

- Télécharge et décompresse automatiquement
- Échoue si le nom ne correspond à aucun artefact du run
- Échoue si le job qui a uploadé n'est pas encore terminé
  (d'où le `needs: build` obligatoire)
