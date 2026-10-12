# Hosteler-IA Repository Structure (SRC.md)

This document provides a 100% complete map of the `hosteler-ia` repository source structure.

## Root Directories & Configuration

- `.atl/`: Skill registry pointer + cache (`.skill-registry.cache.json`, `skill-registry.md`).
- `.github/`: CI workflows (`ci.yml`: type check, unit tests, E2E, build, public-tree gate; `dependabot-auto-merge.yml`) and `dependabot.yml`. No deploy job: deploys run from the private infrastructure repo.
- `.gitcore/`: SWAL_GOAL copy (`docs/SWAL_GOAL.md`). The feature ledger and planning files live in `private/gitcore/` (private repo only).
- `.hermes/`: Agent run context for past waves (`olah4`, `olasaas`, `olasec`, `wave-h2`); monitoring artifacts are gitignored.
- `.husky/`: Git hooks (`commit-msg`, `pre-commit`, `pre-merge-check`, `pre-push`).
- `.vscode/`: Editor config (gitignored).
- `cores/`: Vendored SWAL core packages consumed via `file:`.
  - `cores/gos-client/` → `@swal/gos-client`. `@swal/ui` and `@swal/vault` are no longer vendored: they come from npm (`^0.2.0`).
- `docs/`: product and technical docs: SRS (`docs/SRS/REQUIREMENTS.md`), `docs/producto/`, `LAN-PAIRING-STANDARD.md`, `GOS.md`, WCAG/Tailwind audits. Internal plans, waves, deploy notes and pricing live in `private/docs/`.
- `legacy/`: The old Next.js app. Not in `origin/main`.
- `private/` (private repo only, NOT part of the public tree): `cloud/` (billing, usage, invoices, payments: the optional cloud module, see `src-astro/src/cloud/`), `saas-backend/` + `saas-client/` (SaaS control plane and SDK), `infra/` (real wrangler config, deploy/tenant scripts, deploy workflow), `docs/` (internal plans), `gitcore/` (feature ledger).
- `scripts/`: `public-tree.sh` (files that go to the public repo: everything except `private/**`), `check-public-tree.sh` (fails on real Cloudflare ids, forbidden paths or gitleaks findings outside `private/`).
- `package.json` + `pnpm-workspace.yaml` + `pnpm-lock.yaml`: pnpm monorepo root. Workspace package: `src-astro`.

**There is no `src/`, `prisma/`, `supabase/` or `tests/` at the repo root** — those paths describe the retired Next.js app and now live (where they still apply) under `src-astro/`.

## Source Code Organization (`src-astro/` — canónico desde v0.2.0)

```text
src-astro/
├── src/pages/api/               # REST Workers (D1 + storageRouter), zod en la entrada
│   ├── auth/                   # login/logout/register/me (sesiones Fi'ze)
│   ├── inventory/              # Items + ledger inmutable ([id]/transactions)
│   ├── menu-items/ + categories/ # Carta anidada con validación
│   ├── orders/                 # CRUD + state machine ([id]/transition)
│   ├── tables/ + qr/           # Mesas + endpoint público QR
│   ├── recipes/ + purchases/ + suppliers/  # Costeo real: recetas, compras, factura de proveedor
│   ├── restaurants/            # Tenants
│   ├── orders/[id]/payment     # Registro manual de cobros (metodo + monto), sin pasarela
│   └── saas/ + ai/             # Delegan al modulo cloud (src/cloud); sin el, 404 "cloud disabled"
├── src/pages/                  # Páginas Astro (/, /login, /register, /[slug]/menu, /menu/[restaurantId],
│                               #   /table/[qrCode], /checkout, /order-confirmation/[orderId],
│                               #   /pair, /offline, /dashboard/{index,analytics,client,inventory,notifications,
│                               #   kitchen,menu,orders,purchases,recipes,settings,tables})
├── src/components/             # Islas Svelte 5 (menu, orders, tables, inventory, recipes, purchases,
│                               #   analytics, client, pairing, settings, ai, auth)
├── src/stores/                 # Stores runes (inventory, menu, orders, cart, auth, pairing)
├── src/cloud/                  # Frontera del modulo cloud opcional (types.ts, index.ts servidor, client.ts islas, local/ no-op)
├── src/lib/                    # storageRouter, ledger, state machine, sync, auth, gating
├── src/tokens/                 # Puente de tokens del proyecto (el tema vive en el core)
├── src/layouts/                # BaseLayout.astro (carga el tema del core antes de pintar)
├── src/i18n/                   # Diccionarios en.json, es.json
├── e2e/                        # Playwright specs (flujos + a11y axe-core + manifest PWA)
├── migrations/                 # SQL de D1 (001_vault.sql, 002_domain.sql, 003_sealed_meta_cloud_share.sql, 004_public_menu.sql, 005_auth_rate_limit.sql)
├── public/                     # manifest.json, favicon, icon-*, brand/
├── prisma/                     # Schema retired PostgreSQL, runtime is D1
└── scripts/                    # gen-sw.mjs (Service Worker), build-ci.mjs, seed-demo.mjs, guards
```

## Build & Environment Configuration Files

- `astro.config.mjs`: Astro 7 + Svelte + adaptador Cloudflare + VitePWA (manifest Bone) configuración.
- `package.json` (raíz + `src-astro/`): Dependencies and pnpm scripts.
- `pnpm-lock.yaml`: Canonical pnpm lockfile.
- `pnpm-workspace.yaml`: Workspace member (`src-astro`) + política de `minimumReleaseAge`.
- `src-astro/cloud.config.mjs`: elige la implementacion del modulo cloud (alias `@fize/cloud-impl/*`; `FIZE_CLOUD=1` exige el modulo, `0` lo apaga, sin fijar lo usa si `private/cloud` existe).
- `src-astro/scripts/gen-sw.mjs`: Generación explícita del Service Worker (BackgroundSync).
- `src-astro/tsconfig.json`: TypeScript compiler options (`astro/tsconfigs/strict` + alias `@/*` → `src/*`, `@fize/cloud-impl/*` → `src/cloud/local/*` para el type-check).
- `src-astro/vitest.config.ts`: Vitest testing framework configuration (tests unitarios, muchos junto al módulo en `src/lib/*.test.ts`).
- `src-astro/playwright.config.ts`: Playwright (e2e).
- `src-astro/wrangler.example.jsonc`: plantilla de bindings de Cloudflare (D1 `SWAL_D1`, R2 `SWAL_R2`, KV, AI) con placeholders; copiar a `wrangler.jsonc` (gitignored). `src-astro/wrangler.e2e.jsonc`: solo bindings locales de miniflare, lo usan E2E, CI y el build cuando no hay `wrangler.jsonc`.
- `@swal/ui/tokens.css` (paquete de npm): fuente única del tema Bone; la app lo carga por URL y por import de Vite.

## Integración alimentaria GOS (REQ-007)

- `cores/gos-client/`: cliente canónico vendorizado, exports TS y procedencia.
- `src-astro/src/lib/gos.ts`: singleton, caché IndexedDB/memoria y tolerancia offline.
- `src-astro/src/lib/gosNutrition.ts`: conversión, raciones, alérgenos y parcialidad.
- `src-astro/src/lib/publicMenuNutrition.ts`: proyección pública de totales sin recetas.
- `src-astro/src/lib/menuNutritionCache.ts`: última proyección pública en IndexedDB.
- `src-astro/src/pages/api/menu-nutrition.ts`: enriquecimiento opcional de carta.
- `src-astro/src/components/inventory/GosIngredientPicker.svelte`: búsqueda y vínculo.
- `src-astro/src/lib/fixtures/gos/`: subconjunto del export real, exclusivamente tests.
- `src-astro/src/lib/gos*.test.ts`: cálculo, offline y migración sin schema destructivo.

## Nodo local sin cuenta (docs/producto/NODO-LOCAL.md, tramo 1 — navegador)

- `src-astro/src/pages/local/{index,carta,ajustes,respaldo,publicar,historias}.astro`: páginas estáticas (`prerender`), precacheadas por `gen-sw.mjs`; cabeceras en `public/_headers` (`/local/*`), manifiesto propio `public/local/manifest.webmanifest`.
- `src-astro/src/layouts/LocalLayout.astro`: layout sin enlaces a `/login` ni `/dashboard` (Carta · Mi local · Copia de seguridad · Publicar).
- `src-astro/src/lib/local/localMode.ts`: detección del modo local, dueño local, enlaces públicos de la carta.
- `src-astro/src/lib/local/localApi.ts`: `apiFetch` en modo local despacha a los mismos handlers de `src/pages/api/*` con `locals.storage = IndexedDB` e `instance_id` forzado.
- `src-astro/src/lib/local/storageAdapter.browser.ts`: `createStorageAdapter` del bundle del navegador (alias en `astro.config.mjs`; deja fuera `@swal/vault`).
- `src-astro/src/lib/local/identity.ts`: llave del restaurante (ECDSA P-256 exportable) e `instance_id = local-<base32>`.
- `src-astro/src/lib/local/localDb.ts` + `onboarding.ts`: almacén `fize-local` (identidad, avance, ajustes, código).
- `src-astro/src/lib/local/backupCrypto.ts` + `backupData.ts`: código de recuperación Crockford y copia `fize-backup-enc/v1` (PBKDF2 600.000 → AES-GCM-256).
- `src-astro/src/lib/local/publish.ts`: instantánea firmada → `POST /api/public-menu/<slug>` (endpoint del frente 2).
- `src-astro/src/lib/local/storyLayout.ts`: historias para WhatsApp (1080×1920): zona segura, precio/fecha es-CO, partir texto y enlaces, repartir platos en imágenes, contraste WCAG de los 4 estilos (puro, con tests).
- `src-astro/src/lib/local/storyRender.ts`: dibujo Canvas 2D de las plantillas (menú del día, plato destacado con foto opcional, pide aquí con QR de `qrcode-generator`) con los tokens Bone en vivo.
- `src-astro/src/components/local/`: `Onboarding`, `LocalHome`, `LocalView`, `BackupCard`, `PublishCard`, `CartaQr`, `CloudLevels`, `StoryStudio` (`/local/historias/`: vista previa, compartir con Web Share API o descargar PNG).
- `src-astro/e2e/local-node.spec.ts`: onboarding → carta sin red → copia → borrar → restaurar.
