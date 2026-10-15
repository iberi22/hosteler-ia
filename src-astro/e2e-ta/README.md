# tester-army/e2e tests for Fize

This directory contains `tester-army/e2e` deterministic smoke tests and findings for Fize.

## Installation and Build

Before running the tests, make sure you install dependencies and build the app:
```bash
pnpm install
pnpm --filter fize-astro build:ci
```

## Running the Tests

There are two configs, one per target. `e2e run` without `--config` uses the
nearest `e2e.config.ts`, which declares the `local` target only.

### Local target (`e2e.config.ts`)

Uses `astro preview` on an ephemeral port. Runs the whole suite under
`e2e-ta/**/*.e2e.ts` except `e2e-ta/findings/**`, so the mutating journeys in
`e2e-ta/local/` are included:

```bash
pnpm --filter fize-astro run e2e:ta
# equivalent to: e2e run --config e2e.config.ts (default config)
```

Do not pass `--target live` to this config: `e2e.config.ts` has no `live`
target, so the run fails with `UNKNOWN_TARGET`.

### Live target (`e2e.live.config.ts`)

Read-only verification of a deployment. It reads the host from `E2E_LIVE_URL`
and throws an `Error` if the variable is missing, so it never falls back to a
default host:

```bash
pnpm --filter fize-astro run e2e:ta:live
# equivalent to:
# E2E_LIVE_URL=https://fize.swal.network e2e run --config e2e.live.config.ts
```

To point it at another deployment, pass `--config e2e.live.config.ts` with your
own `E2E_LIVE_URL`.

`e2e.live.config.ts` selects **only** `e2e-ta/smoke.e2e.ts`. The mutating
journeys in `e2e-ta/local/` are never in scope for the live target, however the
run is invoked; the read-only suite cannot submit the onboarding form or create
data against production.

To preview the selection without starting anything:

```bash
E2E_LIVE_URL=https://example.invalid pnpm exec e2e list --config e2e.live.config.ts
```

## Suite Structure

- `e2e-ta/smoke.e2e.ts`: Read-only journeys selected by both configs (landing page, offline page, login form render, PWA manifest). No submit, no click that writes, no POST/PUT/DELETE.
- `e2e-ta/local/*.e2e.ts`: Mutating journeys (e.g., onboarding, form submissions, data creation). Selected by `e2e.config.ts` only, never by `e2e.live.config.ts`.
- `e2e-ta/findings/*.e2e.ts`: Archives of one-off findings; excluded from both configs.

## Results

| journey | local | live |
|---------|-------|------|
| landing opens and shows the start-without-account call to action | passed | passed |
| local onboarding reaches "Paso 4 de 6" | passed | N/A (local config only) |
| local inventory page `/local/inventario` renders its heading | passed | not selected (findings/ excluded) |
| offline page `/offline` renders | passed | passed |
| login page renders the form fields (no submission) | passed | passed |
| PWA manifest is served and parseable | passed | passed |

## Persona Charters for Bug Bash

- `waiter`: You are a waiter taking orders quickly; tap buttons to add items to a table and send to kitchen as fast as possible.
- `diner`: You are a customer at a table scanning the QR code; browse the menu, add different dishes, and proceed to checkout via WhatsApp.
- `manager`: You are a restaurant manager configuring the menu; create new categories, add items with prices, and set them as available or out of stock.
- `kitchen`: You are kitchen staff reading the KDS; move orders from pending to preparing to ready without refreshing the page.
- `cashier`: You are a cashier finalizing orders; select served orders and mark them as paid in cash correctly.
