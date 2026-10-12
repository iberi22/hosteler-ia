# src-astro — Esqueleto Core SWAL para Fi'ze

> **Dual-track:** este directorio es el esqueleto canónico **Astro + Svelte 5 + @swal/ui** (edge-hive theme).
> `src/` (Next.js 16 + React) permanece como legacy hasta el corte Fase 5. No se borra ni se modifica por la migración.

## Stack

- **Astro 7** + `@astrojs/svelte` (jamstack, islands)
- **Svelte 5 runes** (`$state`, `$props`)
- **`@swal/ui` 0.2.0** desde npm (`@swal/ui` ^0.2.0; `@swal/vault` ^0.2.0) (tokens `--swal-*`, 19 componentes)
- **Xavier** `app/hosteler-ia/instance/{id}` + **edge-mesh** `swal/hosteler-ia/{instanceId}` (Fase 3-4)

## Comandos

```bash
cd src-astro
pnpm install
pnpm run check   # astro check (0 errors)
pnpm run build   # astro check && astro build → dist/
pnpm run dev     # astro dev (http://localhost:4321)
```

## Estado (Fase 0 — 2026-08-31)

- [x] `BaseLayout.astro` con `@import '@swal/ui/tokens'` + `<Toaster client:load />`
- [x] `index.astro` demo: `Card`/`Badge`/`Button`/`StatusBadge` (tokens edge-hive verificados)
- [x] `astro check` 0 errors, `astro build` 1 page verde (warning `@import` no bloqueante)

## Próximo (Fase 1)

- `DashboardShell.svelte` wrapping `DashboardLayout.svelte` (nav: inventory/menu/orders/tables/settings/analytics)
- `Landing.svelte` + `GlobalTicker` en `/`
- Reemplazo `hsl(var(--...))` → `--swal-*` con WCAG 4.5:1 audit

El plan de migracion es un documento interno (no se publica).
