# GitHub Actions — Bonnes pratiques CI/CD

Documentation complète des workflows CI/CD pour ce projet **Next.js + Cypress**.

---

## Table des matières

1. [Structure des fichiers](#1-structure-des-fichiers)
2. [Anatomie d'un workflow](#2-anatomie-dun-workflow)
3. [Triggers (déclencheurs)](#3-triggers-déclencheurs)
4. [Jobs et parallélisme](#4-jobs-et-parallélisme)
5. [Tests de composants Cypress](#5-tests-de-composants-cypress)
6. [Tests E2E Cypress](#6-tests-e2e-cypress)
7. [Cache et performance](#7-cache-et-performance)
8. [Variables d'environnement et secrets](#8-variables-denvironnement-et-secrets)
9. [Artefacts et rapports](#9-artefacts-et-rapports)
10. [Bonnes pratiques générales](#10-bonnes-pratiques-générales)
11. [Workflow complet annoté](#11-workflow-complet-annoté)

---

## 1. Structure des fichiers

```
.github/
└── workflows/
    ├── ci.yml          # Pipeline principal (build + tests)
    └── WORKFLOWS.md    # Cette documentation
```

> Chaque fichier `.yml` dans `.github/workflows/` est un workflow indépendant déclenché automatiquement par GitHub.

---

## 2. Anatomie d'un workflow

```yaml
name: CI                        # Nom affiché dans l'onglet Actions de GitHub

on: [...]                       # Déclencheurs

jobs:                           # Ensemble des jobs à exécuter
  mon-job:                      # Identifiant du job (snake_case ou kebab-case)
    name: Mon Job               # Nom lisible affiché dans l'UI
    runs-on: ubuntu-latest      # OS du runner (ubuntu, windows, macos)
    steps:                      # Liste ordonnée des étapes
      - name: Etape 1
        run: echo "hello"
```

### Runners disponibles

| Runner | Usage |
|--------|-------|
| `ubuntu-latest` | Le plus rapide, recommandé par défaut |
| `macos-latest` | Pour tester des apps iOS/macOS |
| `windows-latest` | Pour tester des apps Windows |

---

## 3. Triggers (déclencheurs)

### Déclencher sur push et PR vers certaines branches

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
```

### Déclencher uniquement sur certains fichiers modifiés

```yaml
on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "cypress/**"
      - "package.json"
```

> **Bonne pratique** : limiter avec `paths` évite de lancer le CI pour des changements de docs ou de README.

### Déclencher manuellement (workflow_dispatch)

```yaml
on:
  workflow_dispatch:           # Bouton "Run workflow" dans l'UI GitHub
    inputs:
      environment:
        description: "Environnement cible"
        required: true
        default: staging
        type: choice
        options: [staging, production]
```

### Planifier un job (cron)

```yaml
on:
  schedule:
    - cron: "0 8 * * 1-5"     # Tous les jours de semaine à 8h UTC
```

---

## 4. Jobs et parallélisme

Par défaut, tous les jobs s'exécutent **en parallèle**. Utilisez `needs` pour créer des dépendances.

### Exécution parallèle (défaut)

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [...]

  component-tests:             # Démarre en même temps que build
    runs-on: ubuntu-latest
    steps: [...]

  e2e-tests:                   # Démarre en même temps que build
    runs-on: ubuntu-latest
    steps: [...]
```

### Exécution séquentielle avec `needs`

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [...]

  e2e-tests:
    needs: build               # Attend que build soit vert
    runs-on: ubuntu-latest
    steps: [...]

  deploy:
    needs: [build, e2e-tests]  # Attend que les deux soient verts
    runs-on: ubuntu-latest
    steps: [...]
```

### Matrice de tests (tester sur plusieurs versions Node)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci && npm test
```

---

## 5. Tests de composants Cypress

Les tests de composants vérifient un composant React **isolément**, sans serveur.

### Configuration actuelle

```yaml
component-tests:
  name: Component Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Cypress component tests
      uses: cypress-io/github-action@v6
      with:
        component: true
```

### Exemple de test composant (`components/about-component.cy.tsx`)

```tsx
import AboutComponent from "./about-component";

describe("AboutComponent", () => {
  it("affiche le titre", () => {
    cy.mount(<AboutComponent />);
    cy.get("h1").should("be.visible");
  });

  it("affiche le bon texte", () => {
    cy.mount(<AboutComponent title="Mon titre" />);
    cy.get("h1").contains("Mon titre");
  });
});
```

### Bonnes pratiques pour les tests de composants

```tsx
// ✅ Tester le comportement visible, pas l'implémentation
cy.get("button").click();
cy.get("[data-cy=message]").should("contain", "Envoyé");

// ✅ Utiliser des attributs data-cy dédiés aux tests
cy.get("[data-cy=submit-btn]").click();

// ❌ Ne pas sélectionner par classe CSS (fragile)
cy.get(".btn-primary").click();

// ✅ Tester les états du composant
cy.mount(<Form loading={true} />);
cy.get("button").should("be.disabled");
```

---

## 6. Tests E2E Cypress

Les tests E2E testent le **flux complet** de l'application dans un vrai navigateur.

### Configuration actuelle

```yaml
e2e-tests:
  name: E2E Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Cypress E2E tests
      uses: cypress-io/github-action@v6
      with:
        build: npm run build
        start: npm start
        wait-on: http://localhost:3000
```

### Exemple de test E2E (`cypress/e2e/app.cy.ts`)

```ts
describe("Navigation", () => {
  it("devrait naviguer vers la page about", () => {
    cy.visit("http://localhost:3000");

    cy.get('a[href*="about"]').click();

    cy.url().should("include", "/about");

    cy.get("h1").contains("About Page");
  });
});
```

### Exemple avancé avec `beforeEach` et alias

```ts
describe("Page d'accueil", () => {
  beforeEach(() => {
    cy.visit("/");                        // Réinitialise avant chaque test
  });

  it("charge la page correctement", () => {
    cy.get("h1").should("be.visible");
    cy.title().should("not.be.empty");
  });

  it("intercepte les appels API", () => {
    cy.intercept("GET", "/api/users", { fixture: "users.json" }).as("getUsers");
    cy.visit("/users");
    cy.wait("@getUsers");                 // Attend la réponse API
    cy.get("[data-cy=user-list]").should("have.length", 3);
  });
});
```

### Bonnes pratiques pour les tests E2E

```ts
// ✅ Utiliser des attributs data-cy
cy.get("[data-cy=login-btn]").click();

// ✅ Utiliser cy.intercept pour mocker les API
cy.intercept("POST", "/api/login", { statusCode: 200, body: { token: "abc" } });

// ✅ Éviter les cy.wait() avec un nombre fixe (fragile)
// ❌ cy.wait(2000)
// ✅ cy.wait("@alias") ou cy.get(".element").should("be.visible")

// ✅ Utiliser des fixtures pour les données de test
cy.fixture("user.json").then((user) => {
  cy.get("[data-cy=email]").type(user.email);
});

// ✅ Isoler les tests : ne pas dépendre de l'ordre d'exécution
// Chaque test doit pouvoir tourner indépendamment
```

---

## 7. Cache et performance

### Cacher `node_modules` avec `actions/setup-node`

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 18
    cache: npm           # Cache automatique basé sur package-lock.json
```

### Cacher le dossier Cypress

```yaml
- name: Cache Cypress binary
  uses: actions/cache@v4
  with:
    path: ~/.cache/Cypress
    key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: cypress-${{ runner.os }}-
```

### Cacher le build Next.js entre les jobs

```yaml
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
      - run: npm ci
      - run: npm run build

      - name: Sauvegarder le build
        uses: actions/upload-artifact@v4
        with:
          name: nextjs-build
          path: .next/
          retention-days: 1

  e2e-tests:
    needs: build
    steps:
      - uses: actions/checkout@v4
      - name: Récupérer le build
        uses: actions/download-artifact@v4
        with:
          name: nextjs-build
          path: .next/
      - run: npm start   # Démarre sans rebuild
```

---

## 8. Variables d'environnement et secrets

### Variables d'environnement simples

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      NODE_ENV: test
      BASE_URL: http://localhost:3000
    steps:
      - run: echo "URL: $BASE_URL"
```

### Secrets (valeurs sensibles)

Les secrets se configurent dans **GitHub > Settings > Secrets and variables > Actions**.

```yaml
steps:
  - name: Deploy
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
    run: npm run deploy
```

> **Règle** : Ne jamais écrire une valeur sensible en clair dans un fichier yml. Toujours utiliser `${{ secrets.NOM_DU_SECRET }}`.

### Contextes GitHub utiles

```yaml
steps:
  - run: |
      echo "Branche : ${{ github.ref_name }}"
      echo "SHA : ${{ github.sha }}"
      echo "Auteur : ${{ github.actor }}"
      echo "PR numéro : ${{ github.event.pull_request.number }}"
```

---

## 9. Artefacts et rapports

### Sauvegarder les screenshots Cypress en cas d'échec

```yaml
- name: Cypress E2E tests
  uses: cypress-io/github-action@v6
  with:
    build: npm run build
    start: npm start
    wait-on: http://localhost:3000

- name: Sauvegarder les screenshots
  uses: actions/upload-artifact@v4
  if: failure()                          # Seulement si le job échoue
  with:
    name: cypress-screenshots
    path: cypress/screenshots/
    retention-days: 7

- name: Sauvegarder les vidéos
  uses: actions/upload-artifact@v4
  if: always()                           # Toujours sauvegarder
  with:
    name: cypress-videos
    path: cypress/videos/
    retention-days: 7
```

---

## 10. Bonnes pratiques générales

### Pincer les versions des actions

```yaml
# ❌ Version flottante (risque de breaking change)
uses: actions/checkout@v4

# ✅ Version patchée précise
uses: actions/checkout@v4.1.1

# ✅ Hash SHA (plus sécurisé, immunisé contre les tags modifiés)
uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
```

### Limiter les permissions du GITHUB_TOKEN

```yaml
permissions:
  contents: read         # Lecture seule par défaut
  pull-requests: write   # Seulement si nécessaire

jobs:
  test:
    permissions:
      contents: read     # Surcharger au niveau job si besoin
```

### Conditions d'exécution avec `if`

```yaml
jobs:
  deploy:
    needs: [build, e2e-tests]
    if: github.ref == 'refs/heads/main'   # Deploy uniquement sur main
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy

  notify-failure:
    needs: e2e-tests
    if: failure()                          # Notifier seulement en cas d'échec
    runs-on: ubuntu-latest
    steps:
      - run: echo "Tests échoués !"
```

### Timeout pour éviter les jobs bloqués

```yaml
jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 15        # Tue le job après 15 min
    steps: [...]
```

### Continuer malgré une erreur avec `continue-on-error`

```yaml
steps:
  - name: Tests non bloquants
    run: npm run lint
    continue-on-error: true    # Le job continue même si cette étape échoue
```

---

## 11. Workflow complet annoté

Voici le workflow idéal pour ce projet, combinant toutes les bonnes pratiques :

```yaml
name: CI

on:
  push:
    branches: [main, develop]
    paths:                                    # Ne tourne que si le code change
      - "app/**"
      - "components/**"
      - "cypress/**"
      - "pages/**"
      - "package-lock.json"
  pull_request:
    branches: [main, develop]

# Limiter les permissions par défaut
permissions:
  contents: read

jobs:
  # ─── 1. BUILD ──────────────────────────────────────────────────────────────
  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          NODE_ENV: production

      - name: Upload build artifact
        uses: actions/upload-artifact@v4
        with:
          name: nextjs-build
          path: .next/
          retention-days: 1

  # ─── 2. TESTS COMPOSANTS ───────────────────────────────────────────────────
  component-tests:
    name: Component Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - name: Cypress component tests
        uses: cypress-io/github-action@v6
        with:
          component: true

      - name: Upload screenshots
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: component-screenshots
          path: cypress/screenshots/
          retention-days: 3

  # ─── 3. TESTS E2E ──────────────────────────────────────────────────────────
  e2e-tests:
    name: E2E Tests
    needs: build                             # Réutilise le build du job précédent
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Download build artifact
        uses: actions/download-artifact@v4
        with:
          name: nextjs-build
          path: .next/

      - name: Cypress E2E tests
        uses: cypress-io/github-action@v6
        with:
          start: npm start
          wait-on: http://localhost:3000
          wait-on-timeout: 60

      - name: Upload screenshots si échec
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-screenshots
          path: cypress/screenshots/
          retention-days: 7

      - name: Upload vidéos
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-videos
          path: cypress/videos/
          retention-days: 7
```

---

## Résumé des règles à retenir

| Règle | Pourquoi |
|-------|----------|
| Utiliser `npm ci` plutôt que `npm install` | Reproductible, respecte le lockfile |
| Toujours pinner les versions des actions | Évite les breaking changes silencieux |
| Cacher `node_modules` et les binaires Cypress | Divise le temps d'exécution par 2-3 |
| Sauvegarder les screenshots en cas d'échec | Facilite le debug sans relancer |
| Ne jamais écrire de secrets en clair | Sécurité basique |
| Ajouter un `timeout-minutes` | Évite les coûts liés à des jobs bloqués |
| Utiliser `needs` pour les dépendances | Ordonne les jobs et économise des ressources |
| Tester sur `pull_request` plutôt que post-merge | Attrape les bugs avant qu'ils entrent |
