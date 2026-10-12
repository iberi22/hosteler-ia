# Tailwind 4 audit (2026-10-02)

## Finding

Tailwind CSS 4 is declared but **not used anywhere** in the shipped apps.

Declared (only in `src-astro/package.json` devDependencies):
`tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/postcss` (all `^4.3.3`).
`saas-client` and `saas-backend` do not declare it.

Evidence (grep over `src-astro`, `saas-client`, excluding `node_modules`/`dist`):
- `src-astro/astro.config.mjs`: no tailwind/postcss/vite-plugin reference.
- No `tailwind.config.*`, no `postcss.config.*` in `src-astro` or `saas-client`.
- No `@import "tailwindcss"`, `@tailwind`, `@apply`, `@theme`, `@source`, `@plugin`
  in any `.css`, `.astro` or `.svelte` file under `src-astro/src`.
- No utility-class usage: the `class="...grid..."` hits are hand-written classes
  (`items-grid`, `form-grid`, `dashboard-grid`, ...) defined in component `<style>` blocks
  on `--swal-*` tokens.
- Only mentions outside the lockfile: `README.md:50` and `CHANGELOG.md:90` (stack
  descriptions), plus `cores/swal-ui` (`@tailwind base/components/utilities` in
  `src/styles/global.css` and `tokens/tailwind.ts` preset). `cores/swal-ui` is a separate
  package that does not depend on the `tailwindcss` of `src-astro`, and its Tailwind
  entry point is not imported by `src-astro`.

## Recommendation: remove

Styling is hand-written CSS on `--swal-*` tokens; adopting Tailwind would mean rewriting
every component's styles and conflicts with the token system. The three dependencies add
install time, ~40 `@tailwindcss/oxide-*` native binary entries and supply-chain surface
for nothing. Remove, and fix the stack line in `README.md`/`CHANGELOG.md`.

## Exact removal diff size (measured, NOT applied)

Deleting the 3 lines from `src-astro/package.json` and running `pnpm install --lockfile-only`:
- `src-astro/package.json`: 3 deletions
- `pnpm-lock.yaml`: about 330 deletions, 0 to 3 insertions
  (measured total with the TypeScript pin change included: 3 insertions, 336 deletions
  across the two files)
- plus 1 line each in `README.md` (stack) if the docs are corrected.

Owner decides; nothing has been removed.
