# Next.js + Cypress

This example shows how to configure Cypress to work with Next.js.

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vercel/next.js/tree/canary/examples/with-cypress&project-name=with-cypress&repository-name=with-cypress)

## How to use

Execute [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app) with [npm](https://docs.npmjs.com/cli/init), [Yarn](https://yarnpkg.com/lang/en/docs/cli/create/), or [pnpm](https://pnpm.io) to bootstrap the example:

```bash
npx create-next-app --example with-cypress with-cypress-app
```

```bash
yarn create next-app --example with-cypress with-cypress-app
```

```bash
pnpm create next-app --example with-cypress with-cypress-app
```

Deploy it to the cloud with [Vercel](https://vercel.com/new?utm_source=github&utm_medium=readme&utm_campaign=next-example) ([Documentation](https://nextjs.org/docs/deployment)).

## CI/CD Pipeline

Le pipeline CI s'exécute automatiquement à chaque push sur la branche `devlop` et enchaîne 4 jobs :

```
build → component-tests ─┐
                          ├─→ open-pr → main
e2e-tests (matrix)      ──┘
```

### Jobs

| Job | Description |
|-----|-------------|
| **Build** | Installation des dépendances et build Next.js |
| **Component Tests** | Tests composants Cypress (screenshots + vidéos en cas d'échec) |
| **E2E Tests** | Tests end-to-end sur 3 navigateurs (voir ci-dessous) |
| **Open PR** | Création automatique d'une PR vers `main` si tous les tests passent |

### Matrice de navigateurs (E2E)

Les tests E2E sont exécutés en parallèle sur 3 navigateurs via une `strategy.matrix` :

| Navigateur | Artefacts conservés |
|------------|---------------------|
| **Chrome** | Screenshots (7j) + Vidéos (7j) |
| **Edge** | Screenshots (7j) + Vidéos (7j) |
| **Firefox** | Screenshots (7j) + Vidéos (7j) |

L'option `fail-fast: false` permet de continuer les tests sur les autres navigateurs même si l'un d'eux échoue.

Les screenshots ne sont uploadés qu'en cas d'échec (`if: failure()`), tandis que les vidéos sont toujours uploadées (`if: always()`).

### Cache Cypress

Le binaire Cypress est mis en cache entre les runs via `actions/cache@v4`, invalidé uniquement si `package-lock.json` change.
