# WCAG 2.2 AA Audit Report — Fi'ze (hosteler-ia)

> Fecha original: 2026-09-05 · Wave-H2.27 (refs #254)
> **Corrección 2026-10-05:** este informe NO cierra FEAT-008 al 100%. `features.json` marca FEAT-008 como `completed` / `progress_pct: 100`, pero esta auditoría solo cubre 4 de las páginas que la app sirve.
> **Ampliación 2026-10-27:** el alcance medido sube de 4 a 6 rutas públicas (`/offline` y `/pair` añadidas). Sigue **sin cubrir** el árbol `/dashboard/*`. Este informe no afirma cobertura total: ver "Alcance real" y "Huecos restantes".
> Herramienta: @axe-core/playwright 4.13.0 (`e2e/a11y.spec.ts`)
> Tags: wcag2a, wcag2aa, wcag22aa · página completa (sin `include`), es decir incluye el chrome de `BaseLayout`

## Resultado (medido 2026-10-27)

| Página | Estado | Nota |
|--------|--------|------|
| `/` | ✅ 0 violaciones | |
| `/login` | ✅ 0 violaciones | |
| `/register` | ✅ 0 violaciones | |
| `/checkout` | ✅ 0 violaciones | |
| `/offline` | ✅ 0 violaciones | **nueva en esta pasada**; pública, `prerender = true` |
| `/pair` | ✅ 0 violaciones | **nueva en esta pasada**; pública, monta `PairModal` (`client:load`) |

Run de referencia: `6 passed (14.8s)`, 0 violaciones axe en las 6 rutas
(2026-10-27 16:06, `dist/` construido con `pnpm run build:ci`).
`/offline` responde con un 307 a `/offline/` y sirve 200 en la ruta con barra; axe corre
sobre la página final, así que el redirect no resta cobertura.

## Hallazgos y fixes (commit Wave-H2.27)

Enlaces `<a>` sin estilo usaban el azul por defecto del navegador
(#0000ee, contraste 1.6–2.2:1 sobre fondo oscuro) — violaciones
`color-contrast` (serious) en login, register y checkout.

Fix: color acento `--swal-accent #06b6d4` (contraste ~10:1 sobre #050507)
en `.hint a` (LoginForm/RegisterForm), `.back` (order-confirmation,
CheckoutPanel).

## Hallazgos de la pasada 2026-10-27

**Ninguna violación axe en las 6 rutas públicas.** Run de referencia: 16:06,
`6 passed (14.8s)`, 0 violaciones, `dist/` construido con `pnpm run build:ci`
(es decir, incluye los bindings locales D1/KV/R2).

Lo que sí apareció, y conviene dejarlo escrito porque decide si un rojo es del
producto o del arnés — tres modos de fallo del entorno, todos reproducidos:

| Síntoma en el run | Causa medida | Cómo distinguirlo |
|---|---|---|
| `Timed out waiting 120000ms from config.webServer` | `dist/` construido con el `wrangler.jsonc` real: `dist/server/wrangler.json` sale **sin `SWAL_D1`/`SWAL_R2`**, el preview acepta el puerto y no contesta **ninguna** petición | el fallo es del `webServer`, ni un test llegó a correr. Reconstruir con `pnpm run build:ci` |
| `page.goto: net::ERR_ABORTED / ERR_HTTP_RESPONSE_CODE_FAILURE` | otro proceso del workspace reconstruyendo `dist/` en paralelo: Astro vacía `dist/` al empezar y el preview sirve un árbol a medias | `dist/` desaparece a media ejecución; `ps` muestra otro `astro build` |
| `color-contrast` 1.03–1.09 con `fg #000000`, `target-size` en botones | preview huérfano reteniendo el 4331 o el lock del D1 de miniflare: llega el HTML y abortan los CSS | probe de estilos: `body` con fondo transparente / color por defecto, mientras el CSS scoped de Svelte sí aplica. Con el servidor sano: `rgb(28, 25, 23)` sobre `rgb(250, 249, 245)` (~14:1) |

Un run contaminado por cualquiera de los tres **no es evidencia de violaciones**:
axe estaba midiendo un documento sin estilos o una página que no cargó. Por eso
`e2e/a11y.spec.ts` ahora reintenta la navegación y **no analiza** hasta que el
documento tiene ≥2 hojas de estilo y un `background` real en `<body>`; si tras 3
intentos no lo consigue, el error dice explícitamente que el problema es del
preview, no de la página.

**Preflight obligatorio antes de medir** (el workspace se comparte con otros
agentes que construyen y levantan previews):

```bash
ss -ltn | grep 4331          # debe estar libre; si no, matar el listener
ps -eo args | grep workerd   # workerd huérfano retiene el lock de D1
```


## Alcance real (corregido 2026-10-05, ampliado 2026-10-27)

La tabla de arriba es **el alcance completo de esta auditoría**, y sigue siendo pequeño.

- El spec audita 6 rutas literales, definidas en
  `src-astro/e2e/a11y.spec.ts`:
  `const PAGES = ['/', '/login', '/register', '/checkout', '/offline', '/pair'];`
- La app sirve **40 archivos de ruta Astro**
  (`cd src-astro && find src/pages -name '*.astro' | wc -l` → 40),
  de los cuales **13 están bajo `/dashboard/*`**
  (`find src/pages -path '*dashboard*' -name '*.astro' | wc -l` → 13:
  12 rutas de panel + `dashboard/tables/print`).
  *(El informe de 2026-10-05 decía 22 y 12; el árbol ha crecido desde entonces.
  Los números de esta sección son los medidos hoy.)*
- Cobertura axe de página completa: **6 de 40 archivos de ruta (15 %)**.
- Las 13 rutas de panel —las que un usuario autenticado ve en el uso diario— **no
  están cubiertas por esta auditoría**. No es una suposición: verificado con `curl`
  contra el preview, sin cookie de sesión todas responden
  `302 → /login` (`/dashboard`, `/dashboard/menu`, `/dashboard/orders`,
  `/dashboard/tables/print`). Si se añadieran a `PAGES`, axe auditaría la pantalla
  de login 13 veces y el resultado se leería como "panel limpio".
- Cobertura parcial aparte: `e2e/a11y-dashboard-carta.spec.ts` monta la cookie de
  staff por test y audita `/dashboard/menu` y `/dashboard/recipes` **solo dentro de
  `<main>`** (excluye el chrome de `StaffShell`). Es cobertura real pero parcial:
  2 rutas, subconjunto del DOM, solo impactos `serious`/`critical`.

Por tanto, la afirmación "Cierra stub FEAT-008" sigue sin sostenerse: FEAT-008
("Design Tokens + WCAG") no puede estar al 100 % si el panel nunca se ha auditado
a página completa. Las páginas de panel siguen **abiertas**.

## Huecos restantes (explícitos)

| Hueco | Detalle |
|-------|---------|
| 11 rutas `/dashboard/*` sin auditar | `analytics`, `client`, `index`, `inventory`, `kitchen`, `notifications`, `orders`, `purchases`, `settings`, `tables`, `tables/print` (excluye las dos de `a11y-dashboard-carta`) |
| Chrome del panel | `StaffShell`/sidebar/nav del panel: nunca entra en axe, ni siquiera en las 2 rutas parciales |
| Rutas parametrizadas | `/menu/[restaurantId]`, `/[slug]/menu`, `/table/[qrCode]`, `/order-confirmation/[orderId]`: necesitan datos sembrados (restaurante publicado, pedido existente) |
| Resto del árbol público/local | `local/*` (15 rutas) no auditadas; `/privacidad`, `/terminos` tampoco |
| Estados, no solo páginas | vacío / error / carga / offline de datos, modales abiertos, tablas con filas reales |
| Otros viewports y temas | solo `Desktop Chrome`; sin móvil, sin tema oscuro |

**Seguimiento concreto para cerrar el hueco del panel:** iniciar sesión del owner de
E2E dentro de `e2e/global-setup.ts` (ya existe `staffCookie()` en
`e2e/staff-auth.ts`) y guardar `storageState`; después, iterar las 13 rutas de
`/dashboard/*` desde `a11y.spec.ts` con axe sobre la página completa, esperando el
heading real de cada panel antes de analizar (los headings viven en islas Svelte
`client:load`, no en el HTML de Astro).

## Paleta base y deuda pendiente

- Paleta base hereda tokens `--swal-*` de @swal/ui (edge-hive dark) con tema Bone
  claro por defecto (`--swal-text #1c1917` sobre `#faf9f5`).
- Páginas dashboard (tras login) y tablas con datos reales: re-auditar
  en v0.3.0 con contenido productivo.

## Reproducir

```bash
cd apps/hosteler-ia/src-astro
pnpm run build:ci                  # build con wrangler.e2e.jsonc (sin binding AI)
ss -ltn | grep 4331 && echo "OCUPADO: matar el preview huerfano antes de medir"
pnpm exec playwright test e2e/a11y.spec.ts --reporter=list
```

En NixOS el Chromium que gestiona Playwright no arranca (falta `libnspr4.so` en el
loader path). `scripts/resolve-chromium.ts` detecta el fallo y cae al wrapper
`/nix/store/*-chromium-*/bin/chromium`, que sí corre: la suite se ejecuta con
navegador real, no se salta. En una máquina con las libs presentes el resolver
devuelve `undefined` y Playwright usa su propio binario.
