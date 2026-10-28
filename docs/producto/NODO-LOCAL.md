# Fize — Nodo local sin registro

> Fecha: 2026-10-02. Parte de [ALCANCE.md](ALCANCE.md). Rutas relativas a la raíz del repo (`src-astro/` = app).
> Pedido de Bel: la cliente (restaurante real, arranca ya) usa Fize **en su propio equipo, sin crear cuenta y sin
> datos en el servidor**. Un onboarding le explica todo y, si quiere, **activa la nube después**.
> Este documento adelanta parte de la Fase 3 de ALCANCE ("E2EE real y local primero") y reutiliza la tarea 1.4
> (carta como instantánea en R2). No repite [ONBOARDING.md](ONBOARDING.md): ese es el recorrido **con cuenta en la nube**.

---

## 1. Diagnóstico: qué corre hoy solo en el dispositivo

**Resumen:** casi todas las pantallas del panel son islas Svelte (`client:load`) sobre una página Astro delgada.
Toda la lectura y escritura pasa por `fetch('/api/...')`, y esas rutas corren en el Worker con
`CloudflareVaultAdapter` en modo `serverReadable` (`src/lib/storageAdapter.ts`). **Hoy no hay ningún módulo que
guarde datos del negocio en IndexedDB.** La buena noticia: los handlers de `src/pages/api/*` solo dependen de
`zod`, `createStorageAdapter`, `requireSession(locals)` y librerías puras, así que **pueden ejecutarse en el
navegador sobre IndexedDB** sin reescribir la lógica (ver §2.2).

### 1.1 Por módulo

| Módulo | Interfaz | Datos hoy | ¿Corre local hoy? | Qué falta |
|---|---|---|:-:|---|
| Carta (editor) | `components/menu/MenuPage.svelte` (isla) | `lib/menuSync.ts` → `apiFetch` `/api/categories`, `/api/menu-items` | No | API local (§2.2). `stores/menu.svelte.ts` es `$state` en memoria con platos demo |
| Datos del local / Ajustes | `components/settings/RestaurantForm.svelte` | `fetch` directo a `/api/auth/me`, `/api/restaurants` | No | Pasar a `apiFetch`; `/api/auth/me` local |
| Carta pública + WhatsApp | `pages/[slug]/menu.astro` (SSR) → `components/menu/PublicMenu.svelte` | SSR lee la bóveda (`lib/publicMenuBySlug.ts`). El enlace `wa.me` se arma en el navegador (`buildWhatsappMessage`, `lib/domain.extensions.ts`) | Parcial | `PublicMenu` recibe props: sirve tal cual con una instantánea. Hace `fetch` a `/api/menu-nutrition` (tolerable si falla) |
| Mesas + QR | `components/tables/TableMap.svelte`, `TableQrSheet.svelte` | `api` → `/api/tables`; el QR abre `pages/table/[qrCode].astro` (SSR) | No | En modo local el QR apunta a la carta publicada con `?mesa=N`; `RealQr.svelte` ya genera QR sin red |
| Pedidos / KDS | `components/orders/KitchenQueue.svelte`, `OrderCard.svelte` | `api` → `/api/orders` + `meshSubscribe` (`lib/mesh.ts`) | No | API local (un equipo); varios equipos = malla (§2.4) |
| Pedido del comensal | `components/client/CartSidebar.svelte`, `CheckoutPanel.svelte` | `POST /api/orders`; si falla, `lib/offlineQueue.ts` (IndexedDB) y reenvío al servidor | No sin servidor | El pedido del comensal **no puede llegar** a un nodo local sin servidor: se usa WhatsApp |
| Inventario | `components/inventory/InventoryManager.svelte` | `api`/`apiFetch` → `/api/inventory*`; `lib/inventoryLedger.ts` puro | No | API local |
| Recetas + GOS | `components/recipes/RecipeManager.svelte` | `/api/recipes`, `/api/inventory`; `lib/recipes.ts` puro; GOS es API pública estática (`lib/gos.ts` → `gos.swal.network`) | No | API local; GOS necesita internet la primera vez (cache en `cores/gos-client/src/cache.ts`) |
| Compras / proveedores | `components/purchases/PurchaseManager.svelte` | `/api/suppliers`, `/api/purchases` | No | API local |
| Analítica | `components/analytics/AnalyticsDashboard.svelte` | `fetchCollection(fetch,'orders')` (fetch directo); `lib/analytics.ts` puro | No | Pasar a `apiFetch` |
| Inicio, vista cliente | `pages/dashboard/index.astro`, `pages/dashboard/client/index.astro` | **Frontmatter SSR** (`adapter.list`) | No | Reescribir como isla |
| Sesión / acceso | `src/middleware.ts`, `middlewareGating.ts` | `/dashboard/*` sin sesión → `/login` | — | El modo local no pasa por aquí (páginas estáticas) |

### 1.2 Piezas locales que ya existen

| Pieza | Estado real |
|---|---|
| `lib/idbAdapter.ts` | `StorageAdapter` completo sobre IndexedDB (`fize-db`, un store por entidad, índice `by-instance`), con `persist()` y aviso de cuota. **Probado** (`idbAdapter.test.ts`) pero **ningún componente lo usa** |
| `lib/storageRouter.ts` | En el navegador sin bindings ya elige IndexedDB. Es la base de la API local |
| `lib/storageDurability.ts` | `navigator.storage.persist()` en la primera escritura + toast si se llena la cuota. Listo |
| `lib/idbSync.ts` | Bandeja de salida (outbox) local → nube con reintentos. Sin consumidores. Útil en nivel N3 (§3) |
| `lib/offlineQueue.ts` | Cola de pedidos del comensal; solo sabe reenviar a `/api/orders` |
| `lib/deviceShareStore.ts` + `cloudflareVaultAdapter.ts` | Modo E2EE con partes de la llave en el dispositivo (x=1, x=2) y solo x=3 en la nube (`packWithoutShares`). Ya está en `develop` (la auditoría `docs/ecosistema-salud/offline-mesh.md` está desactualizada en esto) |
| `lib/pairing.ts`, `stores/pairing.svelte.ts`, `pages/pair.astro` | QR con `{relay, room, key, exp}`. **No sirve en tablets:** exige un relay LAN `ws://` (por defecto `ws://192.168.1.50:4444`), que una PWA en `https` bloquea por contenido mixto; la llave de 40 bits solo va en el nombre del room |
| `lib/mesh.ts`, `lib/yjsFleet.ts`, `lib/meshNet.ts` | y-webrtc + y-indexeddb. Sin señalización por defecto (bien: no filtra a servidores públicos), así que hoy la malla está apagada |
| Service worker `scripts/gen-sw.mjs` | `/dashboard/*` = **NetworkOnly** (el panel no abre sin red); páginas públicas NetworkFirst; todo HTML de `dist/client` queda en precache |
| Respaldo | Fize **no tiene**. `@swal/ui` canónico (`cores/swal-ui`, rama `develop`, commit `d747b90`) trae `./storage`, `./backup`, `StorageStatus`, `BackupPanel`, pero **en claro** (`swal-backup/v1`). La copia vendorizada en `cores/swal-ui` de Fize viene de `salud/c1` y no los incluye |
| `@iberi22/edge-mesh/web` | En `cores/edge-mesh` rama `develop` (`9d584c2`): salas HMAC, cifrado AES-GCM, pairing QR v2, transportes `qr-sdp` y `ws`. Worker de señalización con Durable Object (`1b8e3dd`, `workers/signaling`) **no desplegado** |

---

## 2. Arquitectura del modo local

### 2.1 Cómo se sirve

| Decisión | Detalle |
|---|---|
| Rutas | `/local/*` con `export const prerender = true` (como `pages/index.astro` y `offline.astro`). El Worker sirve esos HTML como **assets estáticos**: no ejecuta middleware ni consume cupo de peticiones del Worker ni CPU |
| Offline | Al estar en `dist/client`, `gen-sw.mjs` los precachea: segunda apertura sin red = funciona. Verificar con E2E que `/local/` y `/local/carta/` (barra final) salen del precache |
| Cabeceras | Sin middleware no hay `X-Frame-Options` ni `nosniff`: añadir `public/_headers` para `/local/*` |
| Pantallas | Las mismas islas del panel (`MenuPage`, `RestaurantForm`, luego `InventoryManager`, etc.) montadas en páginas `/local/...` con un layout propio (sin enlaces a `/login`) |
| Origen | IndexedDB es **por origen**. El origen que se elija no debe cambiar nunca (Decisión 1) |

### 2.2 API local en el navegador (pieza central)

`lib/api-client.ts` (`apiFetch`) es el único punto por el que pasan casi todas las islas. En modo local, `apiFetch`
no llama a la red: despacha a un enrutador `lib/local/localApi.ts` que importa los **mismos** módulos de
`src/pages/api/*` y llama su `GET/POST/PATCH/DELETE` con:

- `request`: el `Request` construido; `instance_id` **forzado** a la instancia local (evita mezclar con el demo).
- `locals`: `{ user: dueñoLocal, storage: getIdbAdapter() }`; `createStorageAdapter(locals)` debe respetar
  `locals.storage` si viene (cambio de 2 líneas en `lib/storageAdapter.ts`).

Ventaja: validaciones (zod), reglas (`restaurantRules.ts`, `recipes.ts`, `inventoryLedger.ts`,
`orderStateMachine.ts`) y respuestas son idénticas en local y en nube, y los tests de API existentes se reaprovechan.
Los `fetch` directos que esquivan `apiFetch` se cambian (RestaurantForm, AnalyticsDashboard, CreateMenuItemDialog,
CartSidebar, CheckoutPanel, OrderStatus).
Alternativa descartada: interceptar `/api/*` en el service worker (no controla la primera carga y complica el SW).

### 2.3 Identidad sin cuenta, cifrado en reposo, recuperación

| Tema | Propuesta |
|---|---|
| Identidad del local | Al crear el nodo se genera la **llave del restaurante** (WebCrypto ECDSA P-256, soportado en todos los navegadores; Ed25519 si está). `instance_id = local-<10 caracteres de base32(sha256(llave pública))>`. Se guarda en IndexedDB y **es exportable** para poder ir en la copia cifrada |
| Personal | Sin cuentas. **PIN local** por persona (4–6 dígitos, hash PBKDF2 en IndexedDB) para cambiar de usuario y limitar pantallas (cocina no ve costos). Es control de acceso de interfaz, no cifrado: decirlo así |
| Cifrado en reposo | v1: **sin cifrado de aplicación** sobre IndexedDB. Una llave guardada en el mismo navegador no protege de quien tiene el equipo desbloqueado; la protección real es el bloqueo del equipo (Android y iOS cifran el disco). Opción posterior: "bóveda" con frase al abrir (Decisión 3) |
| Código de recuperación | 16 caracteres Crockford en 4 grupos (`FZ7K-...`), generado en el equipo y **mostrado una vez** para escribir o imprimir. Deriva la llave de las copias (PBKDF2-SHA256, 600.000 iteraciones → AES-GCM 256). SWAL nunca lo conoce |
| Copia cifrada | Sobre `fize-backup-enc/v1` = `{kdf, salt, iv, ciphertext}` cuyo interior es `swal-backup/v1` (formato de `@swal/ui/backup`) con todos los stores de `fize-db` + la llave del restaurante + PINs. Mismo archivo para nivel N1 y N2 |

### 2.4 Varios dispositivos del mismo restaurante

| Paso | Cómo |
|---|---|
| Emparejar | El equipo principal muestra un QR (pairing v2 de `@iberi22/edge-mesh/web`); el nuevo lo escanea. El QR lleva un secreto de un solo uso; por la malla viajan cifradas la llave del restaurante y la llave de la malla. Se reemplaza el pairing actual basado en relay LAN |
| Sincronizar | Un `Y.Doc` por grupo de entidades (carta, mesas, pedidos, inventario) persistido con y-indexeddb; adaptador Y.Doc ↔ `fize-db`. Actualizaciones cifradas con la llave de la malla (`sealUpdate`) |
| Señalización | Solo para que los equipos se encuentren; los datos van directo entre ellos (WebRTC). Opciones: (a) Worker `swal-mesh-signaling` con Durable Object (diseñado, sin desplegar): ~14 peticiones DO por sesión de 3 equipos, dentro del plan gratuito hasta ~1.000 sesiones/día; usa 1 Worker de los 100 de la cuenta, 0 KV, 0 crons. (b) `qr-sdp`: sin servidor, pero hay que volver a escanear cada vez que se reconectan. (c) Relay LAN en un mini-PC (avanzado). Recomendado: (a) con (b) de respaldo |
| Sin malla | Un solo equipo hace todo, o se pasa la información con la copia cifrada (no es sincronización en vivo) |

### 2.5 La carta pública cuando su equipo está apagado

El comensal necesita ver la carta por QR o enlace a cualquier hora. Un nodo local no puede servirla.

| Opción | Cómo | Costo Cloudflare | Veredicto |
|---|---|---|---|
| **A. Instantánea publicada** | Botón "Publicar carta": el equipo arma el JSON público (mismos filtros que `loadMenuBySlug`: `isPublic`, disponibles, `sanitizePublicDescription`, sin recetas ni costos), lo **firma** con la llave del restaurante y lo sube. Se guarda en R2 `public/menu/<slug>.json`; `pages/[slug]/menu.astro` lee primero la instantánea (Cache API 60 s) y renderiza `PublicMenu` igual que hoy | Por publicación: 1 escritura R2 (clase A) + 1 fila D1. Por visita: 1 petición al Worker + lectura R2 solo si no está en caché. 0 KV | **Recomendada.** Es la tarea 1.4 de ALCANCE; sirve igual para restaurantes en la nube |
| A'. Igual pero desde dominio público de R2 | La página es estática y el JSON sale de R2 por CDN | Casi 0 peticiones al Worker | Optimización posterior si crece el tráfico |
| B. Carta dentro del QR/enlace | JSON comprimido en el fragmento de la URL | 0 | Descartada: QR muy denso y cada cambio de precio obliga a reimprimir |
| C. Comensales por la malla | El celular del comensal pide la carta a su equipo | Señalización por visita | Descartada: falla si el equipo está apagado |

**Quién puede publicar sin cuenta:** la primera publicación de un slug exige un **código de activación** que entrega
SWAL (hash en D1); ese primer envío registra la llave pública del restaurante para ese slug y las siguientes
publicaciones solo necesitan su firma. Límites: 256 KB por carta, 30 publicaciones/día por slug (Decisión 2).

**Pedidos:** el comensal arma el pedido en la carta y lo envía por **WhatsApp** al número del restaurante (ya funciona
en `PublicMenu.svelte`, con `tableLabel` en el mensaje). No toca ningún servidor de Fize. Mejora del tramo 2: el
mensaje lleva una línea con código compacto y el mesero la pega en Fize para crear el pedido local.

---

## 3. Persistencia en la nube, opcional ("desplegar persistencia")

| Nivel | Qué es | Qué ve el servidor | Costo para SWAL | Plan |
|---|---|---|---|---|
| **N0 Local** | Todo en el equipo | Nada (solo descarga de archivos estáticos) | ~0 | Gratis |
| **N0+ Carta publicada** | Instantánea pública firmada (§2.5) | Solo la carta pública (clase A de ALCANCE §5.1) | Mínimo | Gratis |
| **N1 Copia en archivo** | Exportar/importar `.fize` cifrado; recordatorio semanal | Nada | 0 | Gratis |
| **N2 Copia cifrada en la nube** | El mismo archivo se sube a R2 (firmado con la llave del restaurante), se guardan las últimas 7; recuperar en un equipo nuevo con el código | Tamaño, fecha y llave pública. **No puede leer el contenido** | 1 escritura R2 por copia; KB–MB | Gratis 1 copia/semana; diaria en pago (Decisión 5) |
| **N3 Sincronización E2EE** | Fase 3 de ALCANCE: `idbSync.ts` sube paquetes sellados (`cloudflareVaultAdapter` sin `serverReadable`, solo la parte x=3 en la nube); sirve de relevo entre equipos que no coinciden en línea | Metadatos (entidad, id, fechas). No el contenido | Filas D1 + R2 por cambio | Pago |
| **N4 Instancia propia** | Lo de hoy: `private/infra/scripts/deploy-tenant.sh <slug>`, cuentas con correo, pedidos de mesa por servidor, IA | **Todo** (`serverReadable`): el operador puede descifrar. Decirlo así (ALCANCE P3) | 1 Worker + uso | Pago ("socio") |

**Migraciones**

- Local → N2: botón "Activar copia en la nube"; no cambia dónde trabaja ella.
- Local → N4: se importa el `swal-backup/v1` interior en la instancia nueva con un endpoint `POST /api/import`
  (solo dueño, reescribe `instance_id`). Las entidades y formas de registro son las mismas (`lib/domain.config.ts`),
  así que es copia, no transformación.
- N4 → local: exportar (tarea 1.7 de ALCANCE) e importar en `/local/respaldo`.
- Cambiar de origen (otro dominio) también es exportar/importar: IndexedDB no viaja entre orígenes.

---

## 4. Onboarding del modo local

Ruta `/local/` (primera vez). Se puede salir y retomar; el avance queda en IndexedDB. Barra fija: `Paso n de 6`.

```
1 ¿Qué es Fize?                         2 Tus datos viven en este equipo
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│ Fize ordena tu carta, pedidos,   │    │ [icono equipo]                   │
│ inventario y cocina.             │    │ Todo se guarda aquí. No creamos  │
│ Sin cuenta. Sin mensualidad.     │    │ cuenta y SWAL no ve tus datos.   │
│ Funciona sin internet.           │    │ Lo que publiques (tu carta) sí   │
│        [Empezar]                 │    │ será público.                    │
└──────────────────────────────────┘    │ [Instalar Fize en este equipo]   │
                                        └──────────────────────────────────┘
3 Tu local                              4 Si pierdes este equipo
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│ Nombre   [Doña Rosa          ]   │    │ Sin copia, se pierde todo.       │
│ WhatsApp [+57 300 ...        ]   │    │ Tu código de recuperación:       │
│ Enlace   fize.swal.network/      │    │   FZ7K-Q2MD-9XHA-T4PE            │
│          [dona-rosa]/menu        │    │ [Imprimir] [Ya lo anoté ✓]       │
│              [Siguiente]         │    │ [Descargar primera copia (.fize)]│
└──────────────────────────────────┘    └──────────────────────────────────┘
5 Publica tu carta                      6 Después, si quieres
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│ (editor de carta / plantilla)    │    │ ▸ Sumar otro equipo (QR)         │
│ Código de activación [______]    │    │ ▸ Copia en la nube (cifrada)     │
│ [Publicar]  → QR + enlace        │    │ ▸ Nube completa con cuentas      │
│ Los pedidos te llegan por        │    │ Nada de esto es obligatorio.     │
│ WhatsApp.                        │    │        [Ir a mi panel]           │
└──────────────────────────────────┘    └──────────────────────────────────┘
```

| Paso | Criterios de aceptación |
|---|---|
| 1 | Carga sin red tras la primera visita. No pide correo ni teléfono personal. Cero llamadas a `/api/*` |
| 2 | Llama a `ensurePersistentStorage()` y muestra el resultado ("protegido" / "el navegador podría borrarlo: instala Fize"). En iOS sin instalar, aviso fijo con instrucciones de "Agregar a inicio" |
| 3 | WhatsApp validado con `validateWhatsapp` y slug con `validateSlug` (`lib/restaurantRules.ts`). Genera la llave del restaurante y la `instance_id` local. Recargar conserva todo |
| 4 | No avanza sin marcar "Ya lo anoté" o descargar la copia. Importar esa copia con el código en otro navegador recupera los datos; con un código errado, error claro y nada se sobrescribe |
| 5 | La carta publicada abre en otro celular (sin sesión), sin recetas ni costos, con botón de WhatsApp. Republicar un precio se ve en ≤ 60 s. Sin código válido o con firma ajena: rechazo |
| 6 | Cada opción explica en una línea qué ve SWAL en ese nivel (tabla §3). Las no disponibles dicen "Próximamente", sin botones muertos |

Meta: carta publicada en **menos de 10 minutos** (misma meta de ONBOARDING.md §6).

---

## 5. Plan de entrega por tramos

Esfuerzo: **S** ≤ 1 día · **M** 2–5 días · **L** 1–3 semanas.

### Tramo 1 — Nodo local mínimo (lo usa la cliente) · M (~3–4 días-persona; ~2 días con 2 frentes en paralelo)

Alcance: datos del local + editor de carta en IndexedDB, onboarding, código de recuperación, copia cifrada en archivo,
carta publicada con QR, pedidos por WhatsApp. Un solo equipo. Sin inventario, recetas ni KDS local.

| Pieza | Archivos | Esf. |
|---|---|:-:|
| Rutas estáticas + layout local + cabeceras | crear `src/pages/local/{index,carta,ajustes,respaldo}.astro`, `src/layouts/LocalLayout.astro`, `public/_headers`; revisar `scripts/gen-sw.mjs` | S |
| API local (carta y local) | crear `src/lib/local/localApi.ts`, `src/lib/local/localMode.ts`; cambiar `src/lib/api-client.ts`, `src/lib/storageAdapter.ts` (`locals.storage`), `RestaurantForm.svelte` (`fetch` → `apiFetch`); `/api/auth/me` local | S |
| Identidad + onboarding | crear `src/lib/local/identity.ts`, `src/components/local/Onboarding.svelte` | S |
| Copia cifrada + código | crear `src/lib/local/backupCrypto.ts`, `src/components/local/BackupCard.svelte`; traer `backup.js`/`storage.js` de `@swal/ui` develop (re-vendorizar o copiar 2 archivos) | S |
| Publicar carta | crear `src/pages/api/public-menu/[slug].ts` (POST firmado), `src/lib/publicMenuSnapshot.ts` (reusa filtros de `publicMenuBySlug.ts`), `migrations/004_public_menu.sql` (`slug, pubkey, activation_hash, updated_at, bytes`); cambiar `pages/[slug]/menu.astro` (instantánea primero) y `middlewareGating.ts` (solo ese POST público) | M |
| QR de la carta | `RealQr.svelte` con `https://fize.swal.network/<slug>/menu?mesa=N`; `PublicMenu` usa `mesa` como `tableLabel` | S |

Pruebas: unitarias (vitest + `fake-indexeddb`): `localApi` CRUD de categoría/plato con `instance_id` forzado;
`backupCrypto` ida y vuelta, código errado y archivo alterado fallan; `publicMenuSnapshot` excluye `isPublic:false`,
no disponibles y descripciones con "receta/costo"; endpoint rechaza sin activación, firma ajena, >256 KB y slug
ajeno. E2E (Playwright, `src-astro/e2e/local-node.spec.ts`): onboarding completo → `context.setOffline(true)` →
recarga y edita → exportar → borrar almacenamiento → importar → datos de vuelta; publicar → abrir
`/<slug>/menu?mesa=3` en otro contexto → enlace `wa.me` con "mesa 3".
Riesgos: módulos de bóveda (`@swal/vault`, usa `Buffer`) arrastrados al bundle del navegador por `storageRouter.ts`
(verificar que no se ejecutan; si estorban, alias en el bundle local); `top-level await` de `storageAdapter.ts` en el
navegador; la precache debe servir `/local/carta/` con y sin barra final.
Costo Cloudflare: 0 KV, 0 crons, 0 Workers nuevos, 1 tabla D1.

### Tramos siguientes

| # | Tramo | Esf. | Archivos principales | Pruebas | Riesgos |
|---|---|:-:|---|---|---|
| 2 | Operación local completa en un equipo: mesas, pedidos/KDS, inventario, recetas+GOS, compras, proveedores, analítica; Inicio como isla; PIN por persona y pantallas por rol; "pegar pedido de WhatsApp"; `StorageStatus`; recordatorio de copia | M | `localApi.ts` (todas las rutas), `pages/local/*`, componentes con `fetch` directo, `components/local/PinGate.svelte` | Rutas API existentes contra IndexedDB; E2E pedido → cocina → cobro → descuento de inventario offline | Volumen de pedidos en IndexedDB (archivar por mes); varias pestañas (avisar con `BroadcastChannel`) |
| 3 | Varios equipos: pairing v2 + malla cifrada + señalización DO | L | adoptar `@iberi22/edge-mesh/web`; reemplazar `lib/pairing.ts`/`mesh.ts`; desplegar `workers/signaling` | Dos contextos Playwright emparejan y convergen; cortar señalización y reconectar; revocar un equipo | Conflictos (CRDT por campo); iOS suspende pestañas; desplegar 1 Worker + DO |
| 4 | Copia cifrada en la nube (N2) | M | `pages/api/backup/[pubkey].ts` (firma), R2 `backup/<pubkey>/`, retención 7 | Restaurar en navegador limpio con el código; firma ajena rechazada; cupo por llave | Abuso de almacenamiento (tope por llave y por día) |
| 5 | Nube completa (N4) e ida y vuelta | M | `pages/api/import.ts`, exportar (ALCANCE 1.7), guía con `deploy-tenant.sh` | Local → instancia → local sin pérdida (conteo por entidad) | Texto honesto: en N4 el operador puede leer |
| 6 | Sincronización E2EE (N3) | L | ALCANCE 3.1–3.3 sobre `idbSync.ts` + `deviceShareStore.ts` | `e2eeCloudBoundary.test.ts` extendido | Recuperación con equipos perdidos |

---

## 6. Decisiones para Bel

| # | Decisión | Recomendación |
|---|---|---|
| 1 | **Dónde vive el modo local** (IndexedDB es por origen: cambiarlo después obliga a exportar/importar) | `https://fize.swal.network/local/`, mismo Worker, assets estáticos. Sin DNS ni Worker nuevo. No usar subdominios por restaurante para el modo local |
| 2 | **Quién publica una carta sin cuenta** | Código de activación entregado por SWAL + llave del restaurante fijada en el primer envío. Abrirlo a cualquiera después, con límites, cuando exista el directorio |
| 3 | **Cifrado de los datos en el equipo** | v1 sin cifrado de aplicación (bloqueo del equipo + PIN de interfaz + copias siempre cifradas). "Bóveda con frase" como opción posterior para equipos compartidos |
| 4 | **Señalización para varios equipos** | Desplegar `swal-mesh-signaling` (DO) en el tramo 3, gratis para el modo local con límites por malla; `qr-sdp` de respaldo. No usar servidores públicos |
| 5 | **Línea gratis / pago** | Gratis: N0, carta publicada, copia en archivo, 1 copia/semana en la nube. Pago: copia diaria, sincronización E2EE (N3), instancia propia (N4), IA |
| 6 | **¿SWAL guarda una llave de rescate?** | No. Si se pierden el equipo, las copias y el código, no hay recuperación. Decirlo en el paso 4 y en la landing ("Tus datos son tuyos") |

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Pérdida de datos con un solo equipo | Paso 4 obligatorio; recordatorio de copia si la última tiene > 7 días (aviso fijo en el panel); N2 en cuanto exista |
| El navegador borra el almacenamiento | `persist()` en el arranque (`storageDurability.ts`); instalar la PWA; mostrar estado con `StorageStatus` |
| iOS Safari | Sin instalar, Safari puede borrar datos de sitios sin uso tras 7 días: exigir "Agregar a inicio" en iOS. Sin Background Sync. Navegación privada = nada persiste: detectar y bloquear el onboarding |
| Equipo compartido o celular personal | PIN por persona; cocina sin acceso a costos; recomendar un equipo del negocio; "Salir y borrar este equipo" en Ajustes |
| Borrar datos del navegador o cambiar de navegador | Explicarlo en el paso 2; la copia es el único rescate |
| Ocupación de slug ajeno | Slug amarrado a la llave del restaurante; el código de activación lo asigna SWAL |
| Expectativa de pedidos de mesa "en vivo" | En local llegan por WhatsApp; los pedidos por servidor son N4 |

---

## 7. Operación: publicar una carta local

Código: `src-astro/src/pages/api/public-menu/[slug].ts` → `src/lib/publicMenuPublish.ts` (reglas),
`src/lib/publicMenuSnapshot.ts` (limpieza y lectura), `migrations/004_public_menu.sql`, `scripts/activation-code.mjs`.
Todos los comandos se corren desde `src-astro/`.

| Paso | Comando / acción |
|---|---|
| 1. Crear las tablas (una vez) | `npx wrangler d1 migrations apply SWAL_D1 --remote` (D1 propia `fize-db`; aplica 001-005 en orden. Ver `private/docs/deploy/FIZE-CLIENTA.md` (interno)) |
| 2. Generar un código | `node scripts/activation-code.mjs <slug>` (sin slug sirve para cualquier enlace libre; mejor amarrarlo). Muestra el código `FZ-XXXX-XXXX` **una sola vez** y el `wrangler d1 execute ... --remote --command "INSERT ..."` con solo su SHA-256. El script no llama a Cloudflare |
| 3. Registrar el código | Revisar y ejecutar el comando que imprimió el paso 2 |
| 4. Entregarlo | Al restaurante, por un canal privado. Sirve una vez: la primera publicación del slug lo gasta y fija la llave del restaurante |
| Cambiar de llave (perdió el equipo y la copia) | `npx wrangler d1 execute fize-db --remote --command "DELETE FROM public_menu WHERE slug='<slug>';"` y volver al paso 2 con ese slug. La carta anterior sigue visible hasta la nueva publicación |
| Retirar una carta | Borrar `public/menu/<slug>.json` del bucket `fize-astro-r2` y la fila de `public_menu`. Se deja de ver en ≤ 60 s |

Respuestas del endpoint: 400 (forma, slug reservado o distinto al de la URL, fecha adelantada > 10 min), 401 (firma),
403 (sin código, código inválido/usado/de otro slug, u otra llave: "Este enlace ya pertenece a otro restaurante"),
409 (carta firmada más vieja que la publicada), 413 (> 256 KB), 429 (> 30 publicaciones en el día UTC).
El servidor vuelve a aplicar los filtros públicos (no disponibles, ocultos, descripciones con "receta/costo/…",
solo campos públicos, ≤ 500 platos y ≤ 100 categorías) aunque el equipo mande otra cosa.

Costo Cloudflare: **por publicación** 1 lectura D1 + 1 fila escrita (2 la primera vez) + 1 escritura R2 clase A;
**por visita** 1 petición al Worker y, si la carta no está en la Cache API (60 s, por centro de datos), 1 lectura
R2 clase B. La ausencia de instantánea también se guarda 60 s, así que las cartas en la nube no pagan R2 extra por
visita. La carta publicada no pide `/api/menu-nutrition`. 0 KV, 0 crons, 0 Workers nuevos.

### Environment Variables
For local deployment and configuration, the following environment variables can be set (e.g. in `.env`):
- `PUBLIC_CLIENT_NAME`: The visible name of the restaurant (default: `Restaurante Demo`).
- `PUBLIC_CLIENT_SLUG`: The public link slug for the menu `fize.swal.network/<slug>/menu`. Must be 3-60 characters, lowercase, numbers, and hyphens (default: `restaurante-demo`).
- `PUBLIC_CLIENT_WHATSAPP`: The WhatsApp number receiving orders, in E.164 format (e.g. `+573005551234`, must start with `+` followed by digits) (default: `+573005551234`).
