# CI/CD — Cache, Artefacts & Types de Tests

> Cours complet avec exemples pratiques

---

## Table des matières

1. [Cache dans GitHub Actions](#1-cache-dans-github-actions)
2. [Artefacts — Screenshots & Vidéos Cypress](#2-artefacts--screenshots--vidéos-cypress)
3. [Pyramide des tests](#3-pyramide-des-tests)
4. [Tests Unitaires](#4-tests-unitaires)
5. [Tests d'Intégration](#5-tests-dintégration)
6. [Tests de Composants (Cypress)](#6-tests-de-composants-cypress)
7. [Tests End-to-End E2E (Cypress)](#7-tests-end-to-end-e2e-cypress)
   - [Matrice de navigateurs (Browser Matrix)](#matrice-de-navigateurs-browser-matrix)
8. [Tests de Régression](#8-tests-de-régression)
9. [Tests de Fumée (Smoke Tests)](#9-tests-de-fumée-smoke-tests)
10. [Tests de Sanité (Sanity Tests)](#10-tests-de-sanité-sanity-tests)
11. [Tests de Performance](#11-tests-de-performance)
12. [Tests de Sécurité SAST / DAST](#12-tests-de-sécurité-sast--dast)
13. [Tests de Mutation](#13-tests-de-mutation)
14. [Tests d'Accessibilité](#14-tests-daccessibilité)
15. [Tests Visuels / Snapshot](#15-tests-visuels--snapshot)
16. [Pipeline complet — placement des tests](#16-pipeline-complet--placement-des-tests)

---

## 1. Cache dans GitHub Actions

### Pourquoi cacher ?

Sans cache, chaque job re-télécharge `node_modules` et le binaire Cypress depuis zéro.

```
Sans cache :  npm ci = ~60s  +  Cypress download = ~40s  → ~100s par job
Avec cache :  npm ci = ~8s   +  Cypress restauré = ~5s   → ~13s par job
```

### Comment fonctionne le cache

GitHub Actions stocke des dossiers sur ses serveurs et les restaure au run suivant si la clé correspond. Si la clé ne correspond pas (ex: `package-lock.json` modifié), il recrée le cache.

```
Run 1 :  cache MISS → télécharge tout → sauvegarde le cache
Run 2 :  cache HIT  → restaure en quelques secondes
Run 3 :  package-lock.json change → cache MISS → recrée
```

### Cache npm via `actions/setup-node`

La façon la plus simple : laisser `setup-node` gérer le cache automatiquement.

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm               # Calcule la clé à partir de package-lock.json
```

Ce que fait cette option en interne :

```yaml
# Équivalent manuel de cache: npm
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: node-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: node-${{ runner.os }}-
```

### Cache du binaire Cypress

Le binaire Cypress (~150 MB) est téléchargé séparément de `node_modules`.
Il se met en cache dans `~/.cache/Cypress`.

```yaml
- name: Cache Cypress binary
  uses: actions/cache@v4
  with:
    path: ~/.cache/Cypress
    key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: cypress-${{ runner.os }}-
```

#### Explication des clés

```yaml
key: cypress-ubuntu-latest-abc123def456   # Clé exacte (hash du lockfile)
restore-keys: cypress-ubuntu-latest-      # Clé de fallback partielle
```

- `key` : recherche un cache exact. Si la clé change (ex: Cypress upgradé), il ne restaure pas.
- `restore-keys` : si aucune clé exacte, restaure le cache le plus récent qui commence par ce préfixe.

### Anatomie complète d'un job avec cache

```yaml
component-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    # 1. Cache npm (node_modules)
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: npm

    # 2. Cache binaire Cypress (séparé de node_modules)
    - name: Cache Cypress binary
      uses: actions/cache@v4
      with:
        path: ~/.cache/Cypress
        key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
        restore-keys: cypress-${{ runner.os }}-

    # 3. Installation (ultra rapide si cache HIT)
    - name: Install dependencies
      run: npm ci

    # 4. Tests
    - name: Cypress component tests
      uses: cypress-io/github-action@v6
      with:
        component: true
```

> **Note** : `cypress-io/github-action` gère aussi son propre cache interne.
> Ajouter `actions/cache` manuellement permet de le partager entre jobs distincts.

### Cache du build Next.js

```yaml
- name: Cache Next.js build
  uses: actions/cache@v4
  with:
    path: |
      .next/cache
    key: nextjs-${{ runner.os }}-${{ hashFiles('package-lock.json') }}-${{ hashFiles('**/*.ts', '**/*.tsx') }}
    restore-keys: nextjs-${{ runner.os }}-
```

Next.js utilise `.next/cache` pour stocker les résultats compilés.
Avec ce cache, les builds suivants ne recompilent que les fichiers modifiés.

---

## 2. Artefacts — Screenshots & Vidéos Cypress

### Différence cache vs artefact

| | Cache | Artefact |
|---|---|---|
| **But** | Accélérer les builds | Stocker des résultats |
| **Partagé entre** | Runs différents | Jobs du même run |
| **Durée** | 7 jours (auto) | Configurable (retention-days) |
| **Visible dans l'UI** | Non | Oui (onglet Actions) |

### Screenshots Cypress

Cypress prend automatiquement un screenshot quand un test **échoue**.
Les fichiers sont sauvegardés dans `cypress/screenshots/`.

```yaml
- name: Upload screenshots si échec
  uses: actions/upload-artifact@v4
  if: failure()                            # Uniquement si le job a échoué
  with:
    name: e2e-screenshots
    path: cypress/screenshots/
    retention-days: 7                      # Supprimé après 7 jours
```

#### `if: failure()` — conditions disponibles

```yaml
if: failure()    # Seulement si une étape précédente a échoué
if: success()    # Seulement si tout a réussi (défaut)
if: always()     # Toujours, peu importe le résultat
if: cancelled()  # Seulement si le job a été annulé
```

### Vidéos Cypress

Cypress enregistre une vidéo de chaque test (même les tests qui réussissent).
Fichiers dans `cypress/videos/`.

```yaml
- name: Upload vidéos
  uses: actions/upload-artifact@v4
  if: always()                             # Toujours uploader les vidéos
  with:
    name: e2e-videos
    path: cypress/videos/
    retention-days: 7
```

> **Conseil** : utiliser `if: always()` pour les vidéos permet de revoir
> le déroulement d'un test même quand il réussit — utile pour déboguer
> des comportements intermittents (flaky tests).

### Comment accéder aux artefacts

1. Aller sur GitHub → onglet **Actions**
2. Cliquer sur le run concerné
3. Descendre en bas de la page → section **Artifacts**
4. Télécharger le zip

```
GitHub Actions Run #42
├── Jobs
│   ├── ✅ Build
│   ├── ✅ Component Tests
│   └── ❌ E2E Tests
│
└── Artifacts
    ├── e2e-screenshots.zip    ← Screenshots des tests en échec
    └── e2e-videos.zip         ← Vidéos de tous les tests
```

### Nommer les artefacts avec le numéro de run

Pour retrouver facilement les artefacts d'un run précis :

```yaml
- name: Upload screenshots si échec
  uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: e2e-screenshots-${{ github.run_number }}
    path: cypress/screenshots/
    retention-days: 7
```

### Configuration complète du workflow actuel

```yaml
# Extrait du ci.yml de ce projet
e2e-tests:
  name: E2E Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Cache Cypress binary
      uses: actions/cache@v4
      with:
        path: ~/.cache/Cypress
        key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
        restore-keys: cypress-${{ runner.os }}-

    - name: Cypress E2E tests
      uses: cypress-io/github-action@v6
      with:
        build: npm run build
        start: npm start
        wait-on: http://localhost:3000

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

## 3. Pyramide des tests

```
              /\
             /  \
            / E2E \              ← Peu, lents, coûteux — testent les flux complets
           /--------\
          / Intégrtn \           ← Nombre moyen — testent plusieurs modules ensemble
         /------------\
        /  Composants  \         ← Testent un composant UI isolé
       /----------------\
      /    Unitaires     \       ← Nombreux, rapides — testent une fonction isolée
     /____________________\
```

| Type | Vitesse | Coût | Ce qu'il teste | Quantité idéale |
|---|---|---|---|---|
| Unitaire | Très rapide (ms) | Bas | Une fonction seule | Beaucoup (70%) |
| Composant | Rapide (s) | Bas-Moyen | Un composant React isolé | Moyen (15%) |
| Intégration | Moyen (s-min) | Moyen | Plusieurs modules liés | Moyen (10%) |
| E2E | Lent (min) | Élevé | Flux utilisateur complet | Peu (5%) |

**Règle d'or** : plus un test est haut dans la pyramide, plus il est lent et fragile.
Ne pas écrire uniquement des tests E2E — ils cassent souvent pour de mauvaises raisons.

---

## 4. Tests Unitaires

### Définition

Testent une **fonction ou méthode isolée**, sans dépendances externes.
Tout ce qui n'est pas la fonction testée est **mocké** (simulé).

### Outils

| Langage | Framework |
|---|---|
| JavaScript / TypeScript | Jest, Vitest |
| Python | pytest, unittest |
| Java | JUnit |

### Exemple — Jest (TypeScript)

```typescript
// utils/price.ts
export function applyDiscount(price: number, percent: number): number {
  if (percent < 0 || percent > 100) throw new Error("Invalid discount");
  return price * (1 - percent / 100);
}
```

```typescript
// utils/price.test.ts
import { applyDiscount } from "./price";

describe("applyDiscount()", () => {
  it("applique une remise de 20%", () => {
    expect(applyDiscount(100, 20)).toBe(80);
  });

  it("retourne le prix original si remise 0", () => {
    expect(applyDiscount(50, 0)).toBe(50);
  });

  it("lève une erreur si remise négative", () => {
    expect(() => applyDiscount(100, -5)).toThrow("Invalid discount");
  });

  it("lève une erreur si remise > 100", () => {
    expect(() => applyDiscount(100, 150)).toThrow("Invalid discount");
  });
});
```

### Patron AAA (Arrange, Act, Assert)

Chaque test doit respecter ce découpage :

```typescript
it("calcule le total du panier", () => {
  // Arrange — Préparer les données
  const items = [
    { price: 10, quantity: 2 },
    { price: 5,  quantity: 1 },
  ];

  // Act — Exécuter le code testé
  const total = calculateCartTotal(items);

  // Assert — Vérifier le résultat
  expect(total).toBe(25);
});
```

### Dans le CI

```yaml
unit-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: npm
    - run: npm ci
    - run: npm test -- --coverage
```

### Bonnes pratiques

```typescript
// ✅ Un test = une assertion principale
it("retourne false si l'utilisateur est banni", () => {
  const user = { banned: true };
  expect(canLogin(user)).toBe(false);
});

// ✅ Tests indépendants — pas d'état partagé entre tests
beforeEach(() => {
  jest.resetAllMocks();    // Réinitialise les mocks avant chaque test
});

// ✅ Nommer clairement : "devrait [résultat] quand [condition]"
it("devrait retourner une erreur quand l'email est vide", () => { ... });

// ❌ Tester plusieurs comportements dans un seul test
it("teste tout", () => {
  expect(add(1, 2)).toBe(3);
  expect(add(-1, 1)).toBe(0);
  expect(() => add(null, 1)).toThrow();  // Si ça échoue, on ne sait pas pourquoi
});
```

---

## 5. Tests d'Intégration

### Définition

Vérifient que **plusieurs composants fonctionnent ensemble** :
service + base de données, route API + middleware, plusieurs modules liés.

### Exemple — Test d'une route API complète (Next.js)

```typescript
// __tests__/api/users.test.ts
import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/users';

describe('GET /api/users', () => {
  it('retourne la liste des utilisateurs', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(Array.isArray(data)).toBe(true);
  });

  it('retourne 405 pour une méthode non autorisée', async () => {
    const { req, res } = createMocks({ method: 'DELETE' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
  });
});
```

### Avec une vraie base de données (service Docker dans CI)

```yaml
# Dans le workflow CI
jobs:
  integration:
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-retries 5
    steps:
      - run: npm run test:integration
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/testdb
```

---

## 6. Tests de Composants (Cypress)

### Définition

Testent un **composant React en isolation**, monté dans un vrai navigateur,
sans démarrer le serveur Next.js entier.

### Différence avec les tests unitaires

| | Test unitaire (Jest) | Test composant (Cypress) |
|---|---|---|
| Environnement | Node.js (simulé) | Vrai navigateur Chromium |
| Ce qu'on teste | Logique pure | Rendu HTML + interactions |
| Vitesse | Très rapide | Rapide |
| Voir le résultat | Non | Oui (screenshot/vidéo) |

### Exemple — Composant `AboutComponent`

```tsx
// components/about-component.tsx
export default function AboutComponent() {
  return (
    <section>
      <h1>À propos</h1>
      <p>Bienvenue sur notre page.</p>
      <button onClick={() => alert("Cliqué !")}>En savoir plus</button>
    </section>
  );
}
```

```tsx
// components/about-component.cy.tsx
import AboutComponent from "./about-component";

describe("AboutComponent", () => {
  beforeEach(() => {
    cy.mount(<AboutComponent />);    // Monte le composant dans le navigateur
  });

  it("affiche le titre", () => {
    cy.get("h1").should("be.visible").and("contain", "À propos");
  });

  it("affiche le bouton", () => {
    cy.get("button").should("exist").and("contain", "En savoir plus");
  });

  it("prend un screenshot de référence", () => {
    cy.get("section").should("be.visible");
    // Cypress sauvegarde un screenshot si le test échoue
  });
});
```

### Dans le CI (ce projet)

```yaml
component-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Cache Cypress binary
      uses: actions/cache@v4
      with:
        path: ~/.cache/Cypress
        key: cypress-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

    - name: Cypress component tests
      uses: cypress-io/github-action@v6
      with:
        component: true              # Lance les tests *.cy.tsx

    - name: Upload screenshots si échec
      uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: component-screenshots
        path: cypress/screenshots/
        retention-days: 3
```

### Bonnes pratiques

```tsx
// ✅ Utiliser data-cy pour les sélecteurs (stable, non couplé au CSS)
cy.get("[data-cy=submit-btn]").click();

// ✅ Tester les états du composant
cy.mount(<Button loading={true} />);
cy.get("button").should("be.disabled");

cy.mount(<Button loading={false} />);
cy.get("button").should("not.be.disabled");

// ✅ Tester l'accessibilité minimale
cy.get("img").should("have.attr", "alt");
cy.get("button").should("not.have.attr", "disabled");

// ❌ Sélectionner par classe CSS (fragile si on refactore le style)
cy.get(".btn-primary-large").click();
```

---

## 7. Tests End-to-End E2E (Cypress)

### Définition

Simulent le **parcours complet d'un utilisateur** dans un vrai navigateur,
avec le serveur Next.js réellement démarré.

### Exemple — Navigation (ce projet)

```typescript
// cypress/e2e/app.cy.ts
describe("Navigation", () => {
  it("navigue vers la page about", () => {
    // 1. Arriver sur la page d'accueil
    cy.visit("http://localhost:3000");

    // 2. Cliquer sur le lien "about"
    cy.get('a[href*="about"]').click();

    // 3. Vérifier l'URL
    cy.url().should("include", "/about");

    // 4. Vérifier le contenu
    cy.get("h1").contains("About Page");
  });
});
```

### Exemple avancé — Avec `beforeEach` et interception réseau

```typescript
// cypress/e2e/pages.cy.ts
describe("Navigation complète", () => {
  beforeEach(() => {
    cy.visit("http://localhost:3000/home");  // Réinitialise avant chaque test
  });

  it("charge la page home", () => {
    cy.get("h1").should("be.visible");
    cy.url().should("include", "/home");
  });

  it("navigue vers about", () => {
    cy.get('a[href*="about"]').click();
    cy.url().should("include", "/about");
    cy.get("h1").contains("About");
  });

  it("intercepte et vérifie un appel API", () => {
    // Simule la réponse API pour isoler le test
    cy.intercept("GET", "/api/data", {
      statusCode: 200,
      body: { message: "ok" },
    }).as("getData");

    cy.visit("/home");
    cy.wait("@getData");                    // Attend que l'appel se produise
    cy.get("[data-cy=status]").should("contain", "ok");
  });
});
```

### Dans le CI (ce projet)

```yaml
e2e-tests:
  name: E2E Tests (${{ matrix.browser }})
  runs-on: ubuntu-latest
  timeout-minutes: 15
  strategy:
    fail-fast: false             # Continue les autres browsers si l'un échoue
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

    - name: Cypress E2E tests (${{ matrix.browser }})
      uses: cypress-io/github-action@v6
      with:
        build: npm run build        # Build Next.js avant de lancer
        start: npm start            # Démarre le serveur
        wait-on: http://localhost:3000  # Attend que le serveur réponde
        wait-on-timeout: 60
        browser: ${{ matrix.browser }}  # Utilise la valeur de la matrice

    - name: Upload screenshots si échec
      uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: e2e-screenshots-${{ matrix.browser }}   # Nom unique par browser
        path: cypress/screenshots/
        retention-days: 7

    - name: Upload vidéos
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: e2e-videos-${{ matrix.browser }}         # Nom unique par browser
        path: cypress/videos/
        retention-days: 7
```

---

### Matrice de navigateurs (Browser Matrix)

#### Pourquoi tester sur plusieurs navigateurs ?

Un test qui passe sur Chrome peut échouer sur Firefox à cause de :
- Différences de rendu CSS
- Support des APIs JavaScript (ex: `IntersectionObserver`, `fetch`)
- Comportement des formulaires ou des événements clavier

```
Chrome  → Moteur Blink  → ~65% des utilisateurs
Edge    → Moteur Blink  → ~4% des utilisateurs
Firefox → Moteur Gecko  → ~3% des utilisateurs
```

#### Comment fonctionne `strategy.matrix`

GitHub Actions génère automatiquement **un job par valeur** de la matrice et les exécute **en parallèle**.

```yaml
strategy:
  matrix:
    browser: [chrome, edge, firefox]
```

Ceci crée 3 jobs distincts :

```
e2e-tests (chrome)   ─┐
e2e-tests (edge)     ─┼─ s'exécutent en parallèle
e2e-tests (firefox)  ─┘
```

Pour référencer la valeur courante dans un step, on utilise `${{ matrix.browser }}` :

```yaml
- name: Cypress E2E tests (${{ matrix.browser }})  # Nom du step dans l'UI
  uses: cypress-io/github-action@v6
  with:
    browser: ${{ matrix.browser }}                 # Passe le navigateur à Cypress
```

#### `fail-fast: false` — comportement par défaut vs configuré

```yaml
# Comportement par défaut (fail-fast: true)
# Si chrome échoue → edge et firefox sont annulés immédiatement
strategy:
  matrix:
    browser: [chrome, edge, firefox]

# Comportement configuré (fail-fast: false)
# Si chrome échoue → edge et firefox continuent quand même
strategy:
  fail-fast: false
  matrix:
    browser: [chrome, edge, firefox]
```

**Quand utiliser `fail-fast: false` ?**

```
fail-fast: true   → Économise du temps/crédits. Utile si les browsers
                    testent la même chose et qu'un échec = tout casser.

fail-fast: false  → Donne un rapport complet sur tous les browsers.
                    Utile pour diagnostiquer des bugs spécifiques à un browser.
```

#### Nommer les artefacts par browser

Sans suffixe `${{ matrix.browser }}`, les 3 jobs tenteraient d'uploader
un artefact avec le même nom → collision et échec.

```yaml
# ❌ Collision : 3 jobs uploadent "e2e-screenshots"
name: e2e-screenshots

# ✅ Noms uniques par browser
name: e2e-screenshots-${{ matrix.browser }}
# → e2e-screenshots-chrome
# → e2e-screenshots-edge
# → e2e-screenshots-firefox
```

#### Résultat dans l'UI GitHub Actions

```
GitHub Actions Run #42
├── Jobs
│   ├── ✅ Build
│   ├── ✅ Component Tests
│   ├── ✅ E2E Tests (chrome)
│   ├── ✅ E2E Tests (edge)
│   └── ❌ E2E Tests (firefox)    ← Seulement Firefox échoue
│
└── Artifacts
    ├── e2e-screenshots-firefox.zip  ← Screenshots de l'échec Firefox
    ├── e2e-videos-chrome.zip
    ├── e2e-videos-edge.zip
    └── e2e-videos-firefox.zip
```

#### Matrice étendue — combiner plusieurs dimensions

On peut croiser plusieurs variables pour créer une matrice 2D :

```yaml
strategy:
  matrix:
    browser: [chrome, firefox]
    viewport: [desktop, mobile]
# → 4 jobs : chrome/desktop, chrome/mobile, firefox/desktop, firefox/mobile
```

#### Exclure certaines combinaisons

```yaml
strategy:
  matrix:
    browser: [chrome, edge, firefox]
    os: [ubuntu-latest, windows-latest]
  exclude:
    - browser: firefox
      os: windows-latest    # Firefox sur Windows exclus
```

### Bonnes pratiques

```typescript
// ✅ Ne pas cy.wait() avec un nombre fixe de ms
// ❌ cy.wait(2000)
// ✅ cy.wait("@alias") ou assertions avec timeout implicite
cy.get("[data-cy=result]").should("be.visible");  // Retry automatique pendant 4s

// ✅ Utiliser des fixtures pour les données de test
cy.fixture("user.json").then((user) => {
  cy.get("#email").type(user.email);
  cy.get("#password").type(user.password);
});

// ✅ Chaque test doit être indépendant
// Ne pas faire dépendre test2 d'une action faite dans test1

// ✅ Éviter les tests trop longs
// Un test E2E = un scénario utilisateur précis (5-10 étapes max)
```

---

## 8. Tests de Régression

### Définition

S'assurent qu'un **bug corrigé ne réapparaît pas** et que les nouvelles
modifications ne cassent pas les fonctionnalités existantes.

### Principe : tout bug corrigé génère un test

```typescript
// Avant la correction : le bug existait
// Après la correction : on ajoute ce test pour éviter la régression

describe("Régression — Bug #1234", () => {
  /**
   * Bug : La navigation vers /about échouait si l'URL
   * contenait des paramètres de requête.
   * Corrigé le 2025-01-10.
   */
  it("navigue vers about même avec des query params", () => {
    cy.visit("http://localhost:3000?ref=newsletter");
    cy.get('a[href*="about"]').click();
    cy.url().should("include", "/about");
  });
});
```

### Dans le CI : s'exécutent à chaque PR

```yaml
- name: Run Regression Tests
  run: npx cypress run --spec "cypress/e2e/regression/**"
```

---

## 9. Tests de Fumée (Smoke Tests)

### Définition

Tests **très rapides** exécutés juste après un déploiement pour vérifier
que les **fonctionnalités critiques fonctionnent**. Si un smoke test
échoue → rollback immédiat.

```
Deploy → Smoke Tests → ✅ OK → Continuer
                     → ❌ Fail → Rollback automatique
```

### Exemple

```typescript
// cypress/e2e/smoke.cy.ts
describe("Smoke Tests — Post-déploiement", () => {
  it("la page d'accueil répond", () => {
    cy.visit("/");
    cy.get("body").should("be.visible");
    cy.title().should("not.be.empty");
  });

  it("la navigation principale est présente", () => {
    cy.visit("/");
    cy.get("nav").should("exist");
  });

  it("la page about charge", () => {
    cy.visit("/about");
    cy.get("h1").should("be.visible");
  });
});
```

### Dans le CI (post-déploiement)

```yaml
deploy:
  steps:
    - run: ./deploy.sh production

smoke-tests:
  needs: deploy
  steps:
    - name: Smoke tests
      uses: cypress-io/github-action@v6
      with:
        spec: cypress/e2e/smoke.cy.ts
      env:
        CYPRESS_BASE_URL: https://monapp.com

    - name: Rollback si échec
      if: failure()
      run: ./rollback.sh production
```

---

## 10. Tests de Sanité (Sanity Tests)

### Définition

Exécutés après un **patch ou correctif ciblé** pour vérifier qu'un module
spécifique fonctionne — sans tout retester.

### Différence Smoke vs Sanity

| | Smoke Tests | Sanity Tests |
|---|---|---|
| Quand | Après tout déploiement | Après un patch ciblé |
| Périmètre | Toute l'app (surface) | Un module précis (profondeur) |
| Objectif | L'app démarre-t-elle ? | Ce fix est-il correct ? |
| Durée | < 5 min | < 15 min |

```typescript
// cypress/e2e/sanity/navigation-fix.cy.ts
/**
 * Sanity post-correction Bug #567
 * Fix : Le lien "About" ne fonctionnait pas sur mobile.
 */
describe("Sanity — Fix navigation mobile", () => {
  it("lien about fonctionne sur viewport mobile", () => {
    cy.viewport("iphone-14");
    cy.visit("/");
    cy.get('a[href*="about"]').should("be.visible").click();
    cy.url().should("include", "/about");
  });

  it("lien about fonctionne sur desktop", () => {
    cy.viewport(1280, 720);
    cy.visit("/");
    cy.get('a[href*="about"]').click();
    cy.url().should("include", "/about");
  });
});
```

---

## 11. Tests de Performance

### Définition

Mesurent les **temps de réponse, le débit et l'utilisation des ressources**
sous conditions normales et sous charge.

### Outil : k6

```javascript
// performance/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10  },    // Montée progressive
    { duration: '1m',  target: 50  },    // Charge nominale
    { duration: '30s', target: 0   },    // Descente
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],  // 95% des requêtes < 500ms
    'http_req_failed':   ['rate<0.01'],  // Taux d'erreur < 1%
  },
};

export default function () {
  const res = http.get('https://monapp.com');

  check(res, {
    'status 200':     (r) => r.status === 200,
    'durée < 500ms':  (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

### Dans le CI (seulement sur main)

```yaml
performance:
  if: github.ref == 'refs/heads/main'
  steps:
    - uses: grafana/k6-action@v0.3.1
      with:
        filename: performance/load-test.js
```

---

## 12. Tests de Sécurité SAST / DAST

### Types

| Acronyme | Nom | Quand | Outil |
|---|---|---|---|
| SAST | Static Application Security Testing | Analyse du code source | Semgrep, SonarQube |
| DAST | Dynamic Application Security Testing | App en cours d'exécution | OWASP ZAP |
| SCA | Software Composition Analysis | Dépendances tierces | Snyk, Dependabot |
| Secrets | Détection de secrets exposés | Code source | gitleaks |

### SAST — Semgrep

```yaml
- name: SAST Scan
  uses: semgrep/semgrep-action@v1
  with:
    config: auto    # Règles automatiques pour JS/TS
```

### SCA — Snyk (vulnérabilités dans node_modules)

```yaml
- name: Snyk Security Scan
  uses: snyk/actions/node@master
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
  with:
    args: --severity-threshold=high
```

### Secrets scanning — Gitleaks

```yaml
- name: Detect Secrets
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 13. Tests de Mutation

### Définition

Évaluent la **qualité des tests** en introduisant des bugs artificiels (mutations)
dans le code. Si les tests ne détectent pas la mutation → tests insuffisants.

```
Code original :   return age >= 18
Mutation :        return age > 18    ← Le test doit échouer !
                  return age <= 18   ← Le test doit échouer !
                  return true        ← Le test doit échouer !
```

### Exemple — Stryker (JavaScript)

```typescript
// Code à tester
function isAdult(age: number): boolean {
  return age >= 18;
}

// Test insuffisant (le mutant age > 18 survit !)
it("adulte", () => {
  expect(isAdult(20)).toBe(true);
});

// Test correct (tue tous les mutants)
it("adulte à exactement 18 ans", () => {
  expect(isAdult(18)).toBe(true);   // Frontière : >= 18
  expect(isAdult(17)).toBe(false);  // Frontière : < 18
  expect(isAdult(0)).toBe(false);
  expect(isAdult(100)).toBe(true);
});
```

```json
// stryker.config.json
{
  "mutate": ["src/**/*.ts"],
  "testRunner": "jest",
  "thresholds": { "high": 80, "low": 60, "break": 50 }
}
```

---

## 14. Tests d'Accessibilité

### Définition

Vérifient que l'application est utilisable par des personnes en situation
de handicap (standard WCAG 2.1 AA).

### Avec Cypress + axe-core

```typescript
// cypress/e2e/accessibility.cy.ts
describe("Accessibilité WCAG", () => {
  it("page d'accueil sans violations", () => {
    cy.visit("/");
    cy.injectAxe();           // Injecte axe-core dans la page
    cy.checkA11y();           // Lance l'analyse et échoue si violations
  });

  it("page about sans violations", () => {
    cy.visit("/about");
    cy.injectAxe();
    cy.checkA11y(null, {
      runOnly: ["wcag2a", "wcag2aa"],  // Niveau de conformité
    });
  });
});
```

### Installation

```bash
npm install --save-dev cypress-axe axe-core
```

```typescript
// cypress/support/e2e.ts
import "cypress-axe";
```

---

## 15. Tests Visuels / Snapshot

### Définition

Capturent des **screenshots de référence** et les comparent à chaque build
pour détecter les régressions visuelles (CSS cassé, composant décalé, etc.)

### Avec Cypress (natif)

```typescript
// cypress/e2e/visual.cy.ts
describe("Tests visuels", () => {
  it("page d'accueil — visuel stable", () => {
    cy.visit("/");
    cy.wait(500);                                // Attendre les animations

    // Crée une baseline au 1er run, compare ensuite
    cy.matchImageSnapshot("homepage", {
      failureThreshold: 0.02,                   // 2% de différence tolérée
      failureThresholdType: "percent",
    });
  });
});
```

### Avec Percy + Cypress

```typescript
// cypress/e2e/visual.cy.ts
describe("Visual Regression", () => {
  it("page d'accueil", () => {
    cy.visit("/");
    cy.percySnapshot("Homepage");               // Envoie à Percy pour comparaison
  });

  it("page about", () => {
    cy.visit("/about");
    cy.percySnapshot("About Page");
  });
});
```

```yaml
- name: Cypress E2E + Percy
  uses: cypress-io/github-action@v6
  with:
    start: npm start
    wait-on: http://localhost:3000
  env:
    PERCY_TOKEN: ${{ secrets.PERCY_TOKEN }}
```

---

## 16. Pipeline complet — placement des tests

### Ordre optimal pour un projet Next.js + Cypress

```yaml
# Flux de ce projet
Push devlop
    │
    ├── build            → Vérifie que le projet compile
    ├── component-tests  → Cypress composants (isolés, sans serveur)
    └── e2e-tests        → Cypress E2E (serveur démarré)
          │
          └── open-pr    → PR automatique vers main (si tout ✅)

Merge vers main
    │
    └── deploy.yml       → SSH → VPS → git pull + build + pm2 restart
```

### Pipeline complet idéal (tous types de tests)

```
STAGE 1 — Rapide (< 2 min) ─────────────────────────────────
  Lint + Format check
  Secrets scan (gitleaks)
  SAST (Semgrep)

STAGE 2 — Tests unitaires (< 5 min) ────────────────────────
  Jest / Vitest
  Coverage > 80%

STAGE 3 — Tests d'intégration + SCA (< 10 min) ─────────────
  API + DB (Docker services)
  Snyk (vulnérabilités dépendances)

STAGE 4 — Build + Deploy Staging ────────────────────────────
  npm run build
  Deploy sur staging

STAGE 5 — Tests post-déploiement (< 20 min) ─────────────────
  Smoke tests        → < 5 min  — rollback si échec
  Composants Cypress → < 10 min
  E2E Cypress        → < 15 min
  Accessibilité      → < 10 min
  Visuels / Snapshot → < 10 min
  DAST (ZAP)         → < 20 min (non bloquant)
  Performance (k6)   → sur main uniquement

STAGE 6 — Deploy Production ─────────────────────────────────
  Si tous les stages verts + branche main
  Smoke post-prod
```

---

## Récapitulatif — Tous les types de tests

| Type | Quand | Durée | Bloquant CI ? |
|---|---|---|---|
| Unitaire | Chaque commit | < 5 min | Oui |
| Composant (Cypress) | Chaque commit | < 10 min | Oui |
| Intégration | Chaque commit | < 10 min | Oui |
| Smoke | Post-déploiement | < 5 min | Oui — rollback |
| E2E | Post-déploiement staging | < 30 min | Oui |
| Régression | Chaque PR | < 15 min | Oui |
| Sanity | Post-patch ciblé | < 15 min | Oui |
| SAST | Chaque commit | < 5 min | Oui |
| SCA (Snyk) | Chaque commit | < 5 min | Selon seuil |
| Secrets scan | Chaque commit | < 2 min | Oui |
| Accessibilité | Post-déploiement | < 10 min | Selon politique |
| Visuel / Snapshot | Post-déploiement | < 10 min | Review manuelle |
| Performance | Sur main uniquement | 10–30 min | Selon seuils |
| Charge / Stress | Hebdomadaire | 30–120 min | Non (reporting) |
| Mutation | Hebdomadaire | 20–60 min | Non (reporting) |

> **Règle d'or** : *"Fail fast, fail early"* — les tests les plus rapides passent
> en premier. On ne bloque la production que sur ce qui compte vraiment.
