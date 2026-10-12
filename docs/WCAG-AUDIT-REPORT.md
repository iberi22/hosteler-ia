# WCAG 2.2 AA Audit Report — Fi'ze (hosteler-ia)

> Fecha: 2026-09-05 · Wave-H2.27 (refs #254)
> **Corrección 2026-10-05:** este informe NO cierra FEAT-008 al 100%. `features.json` marca FEAT-008 como `completed` / `progress_pct: 100`, pero esta auditoría solo cubre 4 de las páginas que la app sirve. Ver "Alcance real" más abajo.
> Herramienta: @axe-core/playwright 4.13.0 (`e2e/a11y.spec.ts`)
> Tags: wcag2a, wcag2aa, wcag22aa

## Resultado

| Página | Estado |
|--------|--------|
| `/` | ✅ 0 violaciones |
| `/login` | ✅ 0 violaciones |
| `/register` | ✅ 0 violaciones |
| `/checkout` | ✅ 0 violaciones |

## Hallazgos y fixes (commit Wave-H2.27)

Enlaces `<a>` sin estilo usaban el azul por defecto del navegador
(#0000ee, contraste 1.6–2.2:1 sobre fondo oscuro) — violaciones
`color-contrast` (serious) en login, register y checkout.

Fix: color acento `--swal-accent #06b6d4` (contraste ~10:1 sobre #050507)
en `.hint a` (LoginForm/RegisterForm), `.back` (order-confirmation,
CheckoutPanel).

## Alcance real (corregido 2026-10-05)

La tabla de arriba no es un resultado parcial ambiguo: es **el alcance completo de
esta auditoría**, y es pequeño.

- El spec audita 4 rutas, definidas literalmente en
  `src-astro/e2e/a11y.spec.ts:4`:
  `const PAGES = ['/', '/login', '/register', '/checkout'];`
- La app sirve **22 páginas Astro** (`cd src-astro && find src/pages -name '*.astro' | wc -l` → 22),
  de las cuales **12 están bajo `/dashboard/*`**
  (`find src/pages -path '*dashboard*' -name '*.astro' | wc -l` → 12).
- Es decir: **4 de 22 páginas auditadas (18 %)**. Las 12 páginas de panel —las que
  un usuario autenticado ve en el uso diario— **no han sido auditadas**.
- Motivo: requieren sesión y datos reales, y el spec no las monta.

Por tanto, la afirmación anterior "Cierra stub FEAT-008" no se sostiene: FEAT-008
("Design Tokens + WCAG") no puede estar al 100 % si el 82 % de las páginas nunca ha
entrado en axe. Las páginas de panel siguen **abiertas** y se difieren a v0.3.0,
como se indica abajo.

## Paleta base y deuda pendiente

- Paleta base hereda tokens `--swal-*` de @swal/ui (edge-hive dark).
- Páginas dashboard (tras login) y tablas con datos reales: re-auditar
  en v0.3.0 con contenido productivo.

## Reproducir

```bash
cd apps/hosteler-ia/src-astro
pnpm run build
pnpm exec playwright test e2e/a11y.spec.ts
```
