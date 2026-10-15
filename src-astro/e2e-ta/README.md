# Suite E2E Smoke (tester-army/e2e) — Fize

Suite de pruebas end-to-end deterministas para la aplicación Fize utilizando la infraestructura `@e2e-dev/web` y `e2e`.

## Requisitos de Instalación y Ejecución

### Requisitos Previos
- Node.js `^22.22.3` o `>=24.8.0` (en este entorno se utiliza Node v24.22.0).
- pnpm activado (`corepack enable`).

### Instalación
Desde la raíz del monorepo o del paquete `src-astro`:

```bash
cd src-astro
pnpm install
```

### Construcción de la Aplicación
Antes de ejecutar las pruebas en el objetivo local (`local`), es necesario construir los artefactos de producción con la configuración CI (sin requerir binding remoto de AI):

```bash
pnpm --filter fize-astro build:ci
```

---

## Ejecución de las Pruebas

### 1. Objetivo Local (`local`)
El runner inicia el servidor de vista previa (`astro preview`) en un puerto libre dinámico y ejecuta la suite de humo determinista:

```bash
pnpm --filter fize-astro run e2e:ta
```

O directamente desde `src-astro`:
```bash
cd src-astro
E2E_TELEMETRY_DISABLED=1 pnpm exec e2e run
```

### 2. Objetivo en Vivo (`live`)
Ejecuta la suite en modo LECTURA contra el entorno de producción en vivo (`https://fize.swal.network`):

```bash
pnpm --filter fize-astro run e2e:ta:live
```

O directamente desde `src-astro`:
```bash
cd src-astro
E2E_TELEMETRY_DISABLED=1 E2E_LIVE_URL=https://fize.swal.network pnpm exec e2e run
```

---

## Resultados de la Ejecución en Sandbox

| # | Journey / Descripción | Local (`pnpm run e2e:ta`) | Live (`pnpm run e2e:ta:live`) |
|---|---|---|---|
| 1 | Landing abre y muestra el CTA sin cuenta (`Empezar gratis, sin registrarme`) | **PASSED** (621 ms) | **PASSED** (1.50 s) |
| 2 | Onboarding local llega a "Paso 4 de 6" y abre el panel local | **PASSED** (1.70 s) | **PASSED** (2.06 s) |
| 3 | Página de inventario local `/local/inventario` renderiza su título | **PASSED** (584 ms) | **FAILED** (404 Not Found en sitio en vivo no actualizado) |
| 4 | Página fuera de línea `/offline` renderiza el título | **PASSED** (348 ms) | **PASSED** (700 ms) |
| 5 | Página de inicio de sesión `/login` renderiza los campos del formulario | **PASSED** (439 ms) | **PASSED** (914 ms) |
| 6 | Manifiesto PWA (`/manifest.webmanifest`) se sirve y es parseable | **PASSED** (390 ms) | **PASSED** (538 ms) |

**Resumen Local:** 6 pasados / 0 fallados en 9.21s
**Resumen Live:** 5 pasados / 1 fallado (`/local/inventario` no desplegado aún en en vivo) en 12.31s

---

## Charters de Personas para Exploración Agéntica (`e2e explore`)

1. **Restaurantero Práctico**: Explora la creación de menús y la configuración del local sin conexión para asegurar un flujo intuitivo sin registro.
2. **Mesero en Hora Pico**: Prueba la gestión rápida de mesas, toma de pedidos y transición de estados en cocina bajo alta interacción.
3. **Comensal Móvil**: Simula la navegación por la carta pública vía código QR en dispositivos móviles y el envío de pedidos por WhatsApp.
4. **Cajero Operativo**: Verifica el registro manual de cobros en efectivo, filtrado de pedidos por estado y persistencia de transacciones.
5. **Administrador Técnico**: Evalúa la resiliencia offline del Service Worker, la sincronización del PWA manifest y la recuperación mediante copias de seguridad.
