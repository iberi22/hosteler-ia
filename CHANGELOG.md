# Changelog

All notable changes to **Hosteler-IA (Fi'ze)** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note**: Hosteler-IA was previously published as `fize` (see `package.json`).
> The brand rename to **Fi'ze** was completed in the wave that introduced Wave-H1
> (`feat-tokens-wcag` / `feat-landing-ticker`). This changelog covers the
> consolidated history from v0.1.0 through the **interim release candidate
> v0.2.0-interim-rc1**, which aggregates Wave-H1 (the first 10 issues of the
> Astro/Svelte 5 migration + Sovereign Node v0.2 surface area).

---

## [2026-10-01] — Tema Bone, costeo real y auditoría a cero

### Summary
42 commits previos a esta entrada (36 directos + 6 merges) en el rango
`git log --since=2026-09-30 --until=2026-10-02`: el rango ya incluye el propio
commit de esta entrada y el del fix del manifest PWA, asi que al releerlo
devuelve 44. El eje es la **ola 7 — tema Bone**: el core `@swal/ui` pasa de la
paleta Edge-Hive (cyan + naranja) a "Bone Warm Minimalist" (un solo tono, acento
= color de texto). En paralelo se cierra el **costeo real** (recetas, compras,
facturas de proveedor) y la auditoría de dependencias queda en **cero avisos**.

### Added
- **Tema Bone Warm Minimalist en el core** (`feat(theme)`, `feat(tema)`): paleta
  medida en `cores/swal-ui` — alabastro `#faf9f5` en claro, carbón mineral
  `#121211` en oscuro, texto `#f5f5f4`/`#1c1917`, grises de piedra, y el acento
  pasa a ser el propio color del texto (un tema de un solo tono).
- **Alias de compatibilidad de tokens** (`feat(tokens)`): los tokens legacy que
  Bone no hereda (`--swal-accent-cyan`, `--swal-neon-green`, `--swal-card-bg`…)
  se redefinen como alias de un **rol**, nunca de un color, para que el tema los
  migre sin tocar los 12 componentes que los usan.
- **Costeo real del restaurante** (`feat(gestion)`, `feat(ui)`): recetas,
  compras, facturas de proveedor y **pedidos por WhatsApp**; paneles de receta y
  de compra en la UI.
- **Registro de lo que el restaurante cobró** (`feat(payments)`).

### Fixed
- **Pagos que nunca se persistían** (`fix(payments)`) y compras que no se
  guardaban mientras el stock avanzaba sin factura (`fix(purchases)`).
- **La UI prometía una integración Bre-B que no existe** (`fix(payments)`): la
  pantalla ya no anuncia algo que el backend no hace.
- **La API exponía costos, pedidos y QR sin autenticación**
  (`fix(security)`), y **`/api/menu-items` y `/api/categories` servían la carta
  cruda sin sesión** (`fix(security)`).
- **El pedido del comensal se perdía**: `create` del storage adapter NUNCA
  fallaba, así que la persistencia no podía reportarse como error
  (`fix(storage)`); la confirmación de pedido queda en 33 tests reales en CI
  (`fix(e2e)`).
- **Idempotencia real del seed** en categorías, inventario y mesas (`fix(seed)`).
- **Carta pública duplicando cada plato dos veces** (`fix(menu)`) y CTA de
  WhatsApp perdido con una fuga de producción interna (`fix(menu)`).
- **Ruta duplicada en `/api/inventory/[id]`** que Astro iba a rechazar al
  compilar (`fix(api)`).
- **Tema que nunca se aplicaba**: el `@import` de `colors.css` no llegaba
  (`fix(theme)`) — rompía el build.
- **Shell inutilizable en móvil** (`fix(ui)`) y selectores `:global()` inválidos
  que rechazaba lightningcss (`fix(ui)`).
- **Bloqueadores de producción para la demo**: auth 500, PWA, moneda y totales
  del KDS (`fix(demo)`).
- **CI con pnpm 11**: `ERR_PNPM_IGNORED_BUILDS` por el postinstall de esbuild y
  workerd sin aprobar (`fix(ci)`).

### Changed
- **Dependencias — auditoría a cero** (`chore(deps)`, `chore(deps-dev)`): se
  pinan los 5 avisos HIGH y TypeScript a 5.9.3 (#352), y se limpian los 3
  MEDIUM restantes. Bumps de `@cloudflare/workers-types`, `@types/node`,
  `typescript` 5.9.3→7.0.2 y `vitest` 3.2.6→5.0.2 vía Dependabot (#311, #312,
  #330, #331, #351).

### Tests
- `test(tema)`: los tests de aliases afirman **a qué rol apunta cada token**, no
  solo que existe — un alias con color fijo reintroduciría el cyan.
- `test(e2e)`: presupuesto de runtime ampliado para los specs multi-llamada, y
  tiempo propio para el test de prueba de negocio H3 de 8 llamadas.

### Docs
- Contexto compartido de la migración al tema Bone para la ola 7
  (`docs/ola-7)`), la trampa de las rutas duplicadas de Astro —solo se ve al
  compilar— (`docs`), y `fize.swal.network` ya activo (`docs(deploy)`).
- `chore`: se ignoran los artefactos locales de Xavier y de monitorización.

---

## [Unreleased] — H3 + H4 admin-100 + SEC (2026-09-06)

### Summary
Admin del restaurante 100% real (era ~35%: páginas con mocks) + seguridad
(authZ + hardening) + e2e con prueba de negocio. Verificado: check 0/0/0,
vitest 173/173, build + SW 53 precache, e2e 16 pass / 16 env-skip / 0 fail.
Issues #259–272 (H4), #285–286 (SEC). Producción: fize-astro v22b85541.

### Added
- **H3 — Receta + descuento automático** (refs #H3, FEAT-024): campo `recipe`
  en menuItem validado 422; transition a `served` descuenta ledger `use`
  idempotente (`stockDeducted`); editor de receta en el diálogo + resumen en tarjeta.
- **H4 admin cableado** (refs #259–#264): inventario/menú/mesas/pedidos leen y
  escriben la API real (loading/error/empty states); KDS acepta array + `mapOrder`,
  transiciones vía endpoint, poll 15s.
- **H4 páginas nuevas** (refs #266–#269): `/dashboard/analytics` (ventas/top/stock bajo),
  `/dashboard/settings` (perfil + plan), `/dashboard/client` (carta + QRs),
  `/` con Landing + GlobalTicker reales (esqueleto Fase-0 eliminado).
- **SEC-01** (refs #285): `requireSession` en writes staff (13 ficheros ruta);
  order-POST público por diseño; rate-limit login KV/memoria + anti-enumeración;
  flag `Secure` en HTTPS.
- **SEC-02** (refs #286): headers (nosniff/referrer/permissions) en middleware;
  sanitizador SVG de QR; tests de fuga QR e invariantes 402 del ledger.
- **E2E** (refs #270): specs admin (CRUD, mock-killers, prueba deduct 10−2×3=4),
  helper `staff-auth` con sesión, gates honestos `PLAYWRIGHT_BROWSERS_OK`.

### Fixed
- KDS ignoraba pedidos backend (esperaba `{list}`, la API devuelve array).
- QR de mesas decorativo no escaneable → RealQr (qrcode-generator).
- URLs `fize.app` inexistentes, mocks Tomates/24-mesas, badge H1.07, copy H1,
  `document.execCommand` deprecado, email `demo@fize.app` en settings.
- Specs e2e adaptados a auth (401 en writes sin sesión) + skips honestos de browser.

---

## [0.2.0] — 2026-09-05

### Summary
**Fi'ze MVP v0.2.0** — migración Next.js → Astro 7 + Svelte 5 completa y
Wave-H2 cerrada (30/30 issues). Verificado: `pnpm run check` 0/0/0,
111 tests unitarios, 12 specs e2e (flujos + axe-core WCAG 2.2 AA),
build limpio + Service Worker con BackgroundSync.

### Added (Wave-H2)
- **FASE 1 — Workers REST API**: CRUD restaurants, tables (+QR público),
  categories, menuItems, orders (+state machine), inventory (+ledger
  inmutable). Endpoints con zod v4, instance isolation y soft deletes.
- **FASE 2 — Offline-first**: IndexedDBAdapter, idbSync (outbox + backoff),
  storageRouter por contexto (vault/surreal/idb/memory).
- **FASE 3 — Stores**: storeSync mappers + loaders en
  inventory/menu/orders/auth (mocks intactos como fallback).
- **FASE 4 — Auth + socio**: sesiones propias Fi'ze (PBKDF2, sin Lucia
  deprecada), middleware de tiers (401/402/redirect), páginas
  /login y /register con i18n en+es.
- **FASE 5 — Flujo cliente**: menú público SSR, mesa por QR con carrito
  offline, confirmación con polling, checkout sin pagos.
- **FASE 6 — PWA**: SW Workbox con cola fi-ze-orders, banner offline,
  install prompt.
- **FASE 7 — Fi'ze AI**: motor de recomendaciones con contexto real +
  RecommendationPanel.
- **FASE 8 — Calidad**: Playwright 12 specs, axe-core 4/4 sin
  violaciones, features.json 100% (23 features, 0 stubs).

### Fixed
- `locals.runtime.env` eliminado en Astro 6 → env vía
  `cloudflare:workers` (era 500 en todos los endpoints en prod).
- Aislados workerd no comparten memoria → D1 `sealed_meta` con
  `CREATE TABLE IF NOT EXISTS` en el vault adapter.
- vite-plugin-pwa 1.3.0 + Vite 8 omite el SW → generación explícita
  con workbox-build (`scripts/gen-sw.mjs`).
- Contraste WCAG: links con acento #06b6d4.

### Changed
- Stack: Astro 7 + Svelte 5 + Tailwind 4 + @swal/ui; backend Cloudflare
  (D1+R2+KV+AI); `cores/swal-vault` vendored para CI autocontenido.
- `package.json` 0.1.0 → 0.2.0 (raíz + src-astro).

---

## [0.2.0-interim-rc1] — 2026-09-02

### Summary
**First interim release candidate** of Fi'ze v0.2 — Sovereign Node surface area
covering dashboard shell, table QR, KDS, stores runes, PWA offline mesh, and
landing/i18n. This is an **interim** RC (not yet tagged for production) because
3 Wave-H1 PRs (#219, #221, #222) remain as **DRAFT** with failing CI on
`pnpm run check` (164 errors / 18 warnings baseline on `main`).

**Status: DO NOT RELEASE.** Awaiting:
- [ ] `pnpm run check` returns 0 errors on `main`
- [ ] PRs #219, #221, #222 promoted from DRAFT to READY (CI green)
- [ ] FEAT-003 (Inventory) unit test coverage gap closed
- [ ] `version` in `package.json` bumped from `0.1.0` → `0.2.0`
- [ ] Conventional 0.2.0 release notes finalized

### Added
- **WAVE-H1.01 — Dashboard Shell** (issue #209, PR #219 DRAFT): `DashboardShell.svelte` wrapping `DashboardLayout` with Fi'ze branding, GlobalTicker, 7 navigation routes (Dashboard, Inventory, Menu, Tables, Orders, Reports, Settings), integrated into `BaseLayout.astro` via `client:load`. Domain configuration in `src-astro/src/lib/domains.ts`. (Refs #209)
- **WAVE-H1.02 — Landing + GlobalTicker** (issue #210, PR #220 MERGED): Astro landing page at `/` with SWAL onboarding copy, animated `GlobalTicker.svelte` for live mesh status, i18n support. (Refs #210)
- **WAVE-H1.03 — Tokens WCAG 4.5:1** (issue #211, PR #220 MERGED): Token system migrated from raw `hsl(...)` to `--swal-*` CSS custom properties. Full WCAG 2.2 AA color contrast audit: all text/background pairs verified ≥ 4.5:1. (Refs #211)
- **WAVE-H1.04 — Inventory Stats + Stock Alerts + Predictions** (issue #212, PR #222 DRAFT): `InventoryStatsCards.tsx`, `StockAlerts.tsx`, `PredictionCard.tsx`, `PredictionChart.tsx`, `PredictionInsights.tsx`. Inventory data model + AI prediction pipeline. (Refs #212)
- **WAVE-H1.05 — Menu Wave-2B** (issue #213, PR — DRAFT): `MenuItemCard.tsx`, `CreateMenuItemDialog.tsx`, Category table integration with inventory. (Refs #213)
- **WAVE-H1.06 — Tables + QRCode** (issue #214, PR #224 MERGED): `TableMap.svelte`, `QRDialog.svelte`, `QRCode.svelte` (core-first — no third-party QR lib). Mesh-aware table state via `tables` rune store. (Refs #214, PR #224)
- **WAVE-H1.07 — Orders KDS** (issue #215, PR — MERGED): `KitchenQueue.svelte`, `OrderCard.svelte`, `StatusBadge.svelte` with realtime mesh updates via Supabase channels. (Refs #215)
- **WAVE-H1.08 — Stores Runes** (issue #216, PR #223 MERGED): Svelte 5 runes for `auth`, `cart`, `inventory`, `orders` stores. `api-client` with 429 backoff interceptor. (Refs #216, PR #223)
- **WAVE-H1.09 — PWA Offline Mesh** (issue #217, PR #221 DRAFT): VitePWA `runtimeCaching` with `NetworkFirst` for API endpoints. `offlineQueue.ts` providing IndexedDB order queuing, `sync-orders` background sync registration, edge-mesh synchronization. (Refs #217, PR #221)
- **WAVE-H1.10 — Xavier Deploy** (issue #218, PR — CLOSED): Xavier ns + mesh ns integration. Cloudflare 5-phase deploy pipeline. (Refs #218)

### Changed
- **`package.json` name**: `fize` (kept for backward compatibility, will be renamed to `@fize/app` in 0.3.0)
- **Token system**: `hsl(...)` → `--swal-*` CSS custom properties (color, spacing, typography)
- **Astro config**: `astro.config.mjs` now bundles Svelte 5 with runes support and `@swal/ui` core (vendored via `file:../../../cores/`)
- **CI**: Node 22 enforced for pnpm 11 + Next 16; wrangler pinned to 4.127.1 for `deploy --config dist/server/wrangler.json`
- **Vite**: `vite-pwa` runtimeCaching strategies (NetworkFirst for `/api/`, CacheFirst for static)

### Fixed
- **A11yButton import path**: `f0537219` — corrected import to `@/components/swal-ui` (avoids TS2305). All 5 landing components updated.
- **CI lockfile mismatch**: `814b07f2` — `pnpm overrides` moved to top-level to avoid `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **Node version mismatch**: `96457340` — CI pinned to Node 22 (pnpm 11 + Next 16 requirement).
- **Wrangler deploy**: `c715c279` — pinned to 4.127.1 for `deploy --config dist/server/wrangler.json` compatibility.
- **Astro check**: `1a990067` — added `vitest+jsdom` to make `astro check` work in CI.
- **Deploy-astro Node**: `839b11f5` — `deploy-astro` workflow now uses Node 22 for Astro ≥ 22.12.
- **@swal/ui vendoring**: `20254fac` — `deploy-astro` clones `@swal/ui` from `cores/` if missing (file: protocol fallback).

### Security
- **API patches (Sentinel, issue #160)**: 5 critical vulnerabilities patched in the REST API surface (rate limit hardening, JWT validation, CORS whitelist).
- **Socket Security**: All Wave-H1 PRs pass Socket.dev dependency scan; no high/critical CVEs introduced.
- **AGPL-3.0**: License header enforcement on all new TypeScript/TSX files (CLA-bot check on PRs).

### Known Issues (Blockers for 0.2.0 stable)
- **DRAFT PRs not promoted**: #219 (DashboardShell), #221 (PWA offline mesh), #222 (Inventory swal-ui scaffold) — `pnpm run check` reports **164 errors / 18 warnings** on `main`. CI checks `Build / E2E / Lint / Type Check / Unit Tests / Vercel` all FAIL on these DRAFTs.
- **Inventory (FEAT-003) test gap**: 10 React components (`InventoryStatsCards`, `StockAlerts`, `PredictionCard`, `PredictionChart`, `PredictionInsights`, `InventoryItemCard`, `InventoryMovementsList`, `CreateCategoryDialog`, `CreateItemDialog`, `StockMovementDialog`) have **zero unit test coverage**. Only `tests/e2e/inventory.spec.ts` (67 lines) provides integration coverage. `tests/unit/` has no inventory test file.
- **Version not bumped**: `package.json` still reads `0.1.0` (legacy `fize` name retained for compatibility).

### Pre-1.0 Hygiene Issues
- 4 issues in `sprint-backlog` label are pre-1.0 hygiene items.
- Biome lint configuration needs a `lint:ci` script that exits 1 on warnings (currently emits warnings only).
- `code-review-report.md` from July 2026 lists 3 unresolved items (deferred to post-1.0).

---

## [0.1.0] — 2026-08-16 (legacy `fize` baseline)

### Added
- **Project bootstrap**: `hosteler-ia` monorepo (Next.js 16 + Astro 5 hybrid) at version `0.1.0`. `features.json` schema v2 with 5 features at 100% completion.
- **Pre-Public Hygiene (issue #197)**: Root cleanup, `features.json` v2 migration, SWAL guides alignment.
- **Docs Standard (issue #195)**: 10 SWAL documentation standards checklist (README, AGENTS.md, SRC.md, SRS, SWAL_GOAL.md, features.json, LICENSE, CLA.md, SECURITY.md, CONTRIBUTING.md).
- **Multi-Tenant Sovereign Node Security (FEAT-005)**: tenant isolation via row-level security in Supabase, JWT-bound API keys.
- **REST API Suite (FEAT-001)**: `/api/orders`, `/api/inventory`, `/api/menu`, `/api/tables`, `/api/auth/*` with Zod validation.
- **PWA Offline Operations & Dexie Sync (FEAT-002)**: Service Worker + IndexedDB for offline order queuing, background sync.

### Known
- Three Wave-3 issues (#166 — a11y to @swal/ui, #159 — deps update, #160 — security patches) shipped post-0.1.0.
- Bolt optimisations (Bolt calendar, Bolt appointments grid) ran on `bolt/*` branches and were NOT merged to main.

---

## Unreleased / Pre-Wave-H1 Hotfixes

- `f0537219` — fix(hosteler-ia): A11yButton import path
- `96457340` — fix(ci): Node 22 for pnpm 11 + Next 16
- `c715c279` — fix(ci): wrangler 4.127.1 for deploy
- `1a990067` — fix(hosteler-astro): vitest+jsdom for astro check
- `839b11f5` — fix(ci): deploy-astro Node 22 for Astro ≥22.12
- `20254fac` — fix(ci): deploy-astro clones @swal/ui if missing
- `814b07f2` — fix(ci): pnpm overrides top-level

---

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) ·
AGPL-3.0-only
