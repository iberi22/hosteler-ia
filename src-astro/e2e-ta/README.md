# tester-army/e2e tests for Fize

This directory contains `tester-army/e2e` deterministic smoke tests and findings for Fize.

## Installation and Build

Before running the tests, make sure you install dependencies and build the app:
```bash
pnpm install
pnpm --filter fize-astro build:ci
```

## Running the Tests

To run the local target (uses `astro preview`):
```bash
pnpm --filter fize-astro run e2e:ta
```

To run the live read-only target against `https://fize.swal.network`:
```bash
pnpm --filter fize-astro run e2e:ta:live
```

## Suite Structure

- `e2e-ta/smoke.e2e.ts`: Read-only journeys that run against both local and live targets (e.g., landing page, offline page, PWA manifest check).
- `e2e-ta/local/*.e2e.ts`: Mutating journeys (e.g., onboarding, form submissions, data creation) that are excluded from the live target and run locally only.

## Results

| journey | local | live |
|---------|-------|------|
| landing opens and shows the start-without-account call to action | passed | passed |
| local onboarding reaches "Paso 4 de 6" | passed | N/A |
| local inventory page `/local/inventario` renders its heading | passed | failed (404 Not Found) |
| offline page `/offline` renders | passed | passed |
| login page renders the form fields (no submission) | passed | passed |
| PWA manifest is served and parseable | passed | passed |

## Persona Charters for Bug Bash

- `waiter`: You are a waiter taking orders quickly; tap buttons to add items to a table and send to kitchen as fast as possible.
- `diner`: You are a customer at a table scanning the QR code; browse the menu, add different dishes, and proceed to checkout via WhatsApp.
- `manager`: You are a restaurant manager configuring the menu; create new categories, add items with prices, and set them as available or out of stock.
- `kitchen`: You are kitchen staff reading the KDS; move orders from pending to preparing to ready without refreshing the page.
- `cashier`: You are a cashier finalizing orders; select served orders and mark them as paid in cash correctly.
