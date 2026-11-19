# Continuous Integration

CI is defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and runs on
every pull request and on pushes to `master` / `main`.

## Jobs and gates

| Job | What it runs | Why it exists |
| --- | --- | --- |
| `contract` | `cargo test --all` | Verifies the Soroban contracts and their Rust unit/integration tests. |
| `sdk` | `npm run build` and `npm run test:sdk` | Type-checks the SDK, emits `dist/`, and runs the SDK unit suites. |
| `ui` | `npm run test:ui` | Runs the React/UI suites in a jsdom environment. |
| `integration` | `npm run test:integration` and `npm run test:performance` | Exercises cross-layer SDK flows and performance smoke tests with mocked network calls. |
| `release-gate` | Requires all of the above | Blocks release-style pushes to `master`/tags unless every gate passed. |

The SDK build gate is meaningful: `npm run build` runs `tsc` with the repository
`tsconfig.json` and must succeed before tests are executed.

## Running locally

```bash
npm ci

npm run build
npm run test:sdk
npm run test:ui
npm run test:integration
npm run test:performance

# Everything at once
npm test
```

## Quarantined UI suites

The Jest `ui` project currently ignores two suites:

- `ui/src/__tests__/beneficiaryPagination.test.tsx`
- `ui/src/__tests__/searchFilter.test.tsx`

`BeneficiaryRegistration` still loads beneficiaries through
`listBeneficiariesByDisaster` and does not expose the paginated/search API
those tests target, so they fail independently of SDK changes. Remove the
`testPathIgnorePatterns` entries in `jest.config.js` once the component is
migrated to `listBeneficiariesPaginated` / `searchBeneficiaries`.

## Adding a new project

Jest uses a multi-project configuration in [`jest.config.js`](../jest.config.js):

- `sdk` – `sdk/src/**/*.test.ts`
- `ui` – `ui/src/**/*.test.ts(x)`
- `integration` – `tests/integration/**/*.test.ts`
- `performance` – `tests/performance/**/*.test.ts`

Use the matching `npm run test:<project>` script so CI picks the suite up
without changes to the workflow.
