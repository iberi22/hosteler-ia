# Fize — Alcance del producto

> Documento maestro. Fecha: 2026-10-02. Rama base: `develop`.
> Documentos hijos: [ONBOARDING.md](ONBOARDING.md) · [DIRECTORIO.md](DIRECTORIO.md) · [LANDING.md](LANDING.md).
> Las rutas de código son relativas a la raíz del repo `iberi22/hosteler-ia`.
> Nota: `AGENTS.md` del repo todavía habla de Next.js y Prisma. Está desactualizado: el stack real es
> Astro 7 + Svelte 5 SSR en un Worker de Cloudflare (`src-astro/astro.config.mjs`: `output: "server"`).

---

## 1. Visión

Fize ayuda a cualquier negocio de comidas (restaurante, corrientazo, cafetería, panadería, comidas
rápidas) a tener **orden en la cocina y en la administración**: carta, recetas, inventario que se
descuenta solo, compras, pedidos a cocina y mesas con QR. Además conecta a los comensales con
**cartas reales cerca de ellos**.

**Promesa:** gratis al 100 % para el negocio, sus datos son suyos, no los usamos ni los vendemos, y se
guardan cifrados desde el primer registro.

## 2. Principios (reglas de diseño, no eslóganes)

| # | Principio | Consecuencia concreta |
|---|-----------|-----------------------|
| P1 | **Gratis de verdad** | Nada del flujo diario (carta, pedidos, inventario, recetas, QR) queda detrás de un pago. Lo opcional de pago solo puede ser algo que cueste dinero real a SWAL (respaldo gestionado, IA, dominio propio). |
| P2 | **Tus datos son tuyos** | Sin publicidad con rastreo, sin venta de datos, sin analítica de terceros. Exportar y borrar todo debe ser posible. |
| P3 | **Honestidad sobre el cifrado** | Hoy los datos están cifrados en reposo, pero el operador **puede** descifrarlos (ver §5). No decimos "solo tú puedes leerlos" hasta que eso sea verdad (Fase 3). |
| P4 | **Local primero** | El trabajo diario vive en el dispositivo (IndexedDB) y en la red local del restaurante; la nube sincroniza. Si se cae internet, la cocina sigue. |
| P5 | **Backend casi en cero** | El plan gratuito de Cloudflare es compartido por TODOS los proyectos SWAL. Lo público se sirve estático o desde caché; nada de KV en rutas calientes; nada de escaneos de base de datos por visita. Ver `private/docs/CLOUDFLARE-CUPOS.md` (interno). |
| P6 | **Solo datos públicos de terceros** | Un negocio que no se registró solo aparece con hechos públicos (nombre, ubicación, categoría) y con opción visible de reclamar o salir. |
| P7 | **Español de Colombia primero** | Pesos (COP), WhatsApp, Bre-B, efectivo/datafono, horarios en hora de Bogotá. |

## 3. Tipos de usuario

| Usuario | Quién es | Qué necesita | Cómo entra |
|---------|----------|--------------|------------|
| **Dueño** | Quien administra el negocio | Montar la carta, costos, inventario, ver ventas, invitar personal | Cuenta con correo y contraseña (primer usuario de la instancia = dueño) |
| **Personal (sala/caja)** | Mesero, cajero | Tomar pedidos, cobrar, ver mesas | Invitación del dueño |
| **Cocina** | Cocinero, auxiliar | Ver comandas (KDS), marcar listo, ver recetas permitidas | Tableta de cocina emparejada o invitación |
| **Comensal** | Cliente en la mesa o en casa | Ver carta, filtrar alérgenos, pedir por mesa o WhatsApp | Sin cuenta: QR de la mesa o enlace |
| **Visitante** | Persona buscando dónde comer | "Menús cerca de mí" con filtros | Sin cuenta, sin cookies |
| **Admin SWAL** | Equipo SWAL | Aprobar reclamos, atender bajas (opt-out), salud del servicio | Consola interna (no existe hoy) |

## 4. Mapa de áreas

Estado: **Existe** = funciona en `develop` · **Parcial** = existe pero falta algo para v1 · **Falta** = no hay código.

### 4.1 Landing

| | |
|---|---|
| Estado | **Parcial**. `src-astro/src/pages/index.astro` + `src-astro/src/components/Landing.svelte`. Mensaje "Sistema inteligente para hostelería"; el CTA principal es "Acceso del personal" (`/login`). No habla de gratis ni de privacidad, no tiene "Registrar mi restaurante" ni "Menús cerca de mí". Se renderiza en SSR (sin `prerender`): cada visita consume una petición del Worker. PR #353 (`feat/redesign-visual`) abierto con rediseño y token `--swal-on-accent`. |
| v1 | Nueva landing según [LANDING.md](LANDING.md), prerenderizada (`export const prerender = true`), sobre la base del PR #353. |
| Después | Páginas por ciudad ("Menús en Bogotá") generadas desde el índice del directorio. |

### 4.2 Registro y onboarding

| | |
|---|---|
| Estado | **Parcial**. `src-astro/src/pages/register.astro`, `src-astro/src/components/auth/RegisterForm.svelte`, `src-astro/src/pages/api/auth/register.ts` (commit `707b748e2`: el primer usuario de la instancia es `owner`; después solo un dueño con sesión da de alta personal, siempre como `staff`). El local se crea en ajustes (`src-astro/src/components/settings/RestaurantForm.svelte`: nombre, slug, dirección). **No hay campo de WhatsApp en la interfaz**: la API lo acepta (`src-astro/src/pages/api/restaurants/index.ts`, `[id].ts`) pero solo el seed lo llena (`src-astro/scripts/seed-demo.mjs`). Sin horarios, ubicación, tipo de cocina ni asistente guiado. El slug **no es único**: en producción hubo dos restaurantes con el mismo slug y `src-astro/src/lib/publicMenuBySlug.ts` desempata prefiriendo el que tiene teléfono. |
| v1 | Asistente de 6 pasos ([ONBOARDING.md](ONBOARDING.md)), slug validado y único, WhatsApp, ubicación, horarios, tipo de cocina, plantillas de carta, mesas y QR, invitación de personal, publicar. |
| Después | Importar carta desde foto/PDF/texto; reclamar ficha de OpenStreetMap; varias sedes. |

### 4.3 Panel del restaurante (`/dashboard/*`)

| Módulo | Estado hoy | Archivos | v1 | Después |
|--------|-----------|----------|----|---------|
| Inicio (resumen del día) | Existe | `src-astro/src/pages/dashboard/index.astro` | Lista de "siguientes pasos" mientras el onboarding no esté completo | Alertas proactivas |
| Carta (categorías y platos) | Existe | `src-astro/src/pages/dashboard/menu/index.astro`, `src-astro/src/components/menu/{MenuPage,CategoryTable,CreateMenuItemDialog,MenuItemCard}.svelte` | Foto del plato, disponible/agotado rápido, botón "Publicar cambios" | Modificadores (tamaños, adiciones), combos |
| Recetas y costeo | Existe | `src-astro/src/pages/dashboard/recipes/index.astro`, `src-astro/src/components/recipes/RecipeManager.svelte`, `src-astro/src/lib/recipes.ts` | Costo por porción y margen visibles en la carta interna | Escandallo con mermas |
| Inventario | Existe | `src-astro/src/pages/dashboard/inventory/index.astro`, `src-astro/src/components/inventory/*`, `src-astro/src/lib/inventoryLedger.ts` | Igual | Conteo físico guiado |
| Ingredientes GOS (nutrición, alérgenos) | Existe | `src-astro/src/components/inventory/GosIngredientPicker.svelte`, `src-astro/src/lib/gos.ts`, `gosNutrition.ts`, `docs/GOS.md` | Igual | Sugerir vínculo GOS al crear insumo |
| Compras y proveedores | Existe | `src-astro/src/pages/dashboard/purchases/index.astro`, `src-astro/src/components/purchases/PurchaseManager.svelte` | Igual | Lista de compras sugerida por stock mínimo |
| Pedidos y cocina (KDS) | Existe | `src-astro/src/pages/dashboard/{orders,kitchen}/index.astro`, `src-astro/src/components/orders/{KitchenQueue,OrderCard}.svelte`, `src-astro/src/lib/orderStateMachine.ts` | El KDS consulta la nube cada 15 s (`KitchenQueue.svelte`, `setInterval(pollBackend, 15_000)`): ~2.900 peticiones/día por pantalla en 12 h. v1: sincronización por red local cuando haya emparejamiento y sondeo en la nube cada 60 s como respaldo | Sonido/vibración por comanda nueva |
| Mesas y QR | Existe | `src-astro/src/pages/dashboard/tables/index.astro`, `src-astro/src/components/tables/{TableMap,QRDialog}.svelte`, `src-astro/src/components/RealQr.svelte`, `src-astro/src/lib/tableQr.ts` | Crear N mesas de una vez; hoja imprimible con QR | Planos de sala |
| Cobros | Parcial | `src-astro/src/pages/api/orders/[id]/payment.ts`, `src-astro/src/lib/payments.ts`, `src-astro/src/components/orders/PaymentForm.svelte` (registro manual: efectivo, datafono, Bre-B, transferencia; sin pasarela ni webhook) | Igual (registro manual) | Bre-B automático si existe integración oficial |
| Analítica | Existe | `src-astro/src/pages/dashboard/analytics/index.astro`, `src-astro/src/components/analytics/*` | Igual | Comparativos por semana |
| Recomendaciones IA | Existe (tier `socio`) | `src-astro/src/pages/api/ai/infer.ts`, `src-astro/src/components/ai/RecommendationPanel.svelte` | Sin cambios; fuera del flujo gratuito básico | IA local en el dispositivo |
| Ajustes del local | Parcial | `src-astro/src/pages/dashboard/settings/index.astro`, `src-astro/src/components/settings/RestaurantForm.svelte` (+ `UsagePanel`/`PlanPanel` del modulo cloud) | WhatsApp, ubicación, horarios, cocina, rango de precio, perfil público | Dominio propio |
| Personal y roles | **Falta** (solo API) | `role` se guarda (`src-astro/src/lib/auth/session.ts`, default `staff`) pero **ninguna ruta lo comprueba**: el personal tiene los mismos poderes que el dueño | Pantalla de personal, invitación, roles `owner/staff/cocina/caja` con matriz de permisos (§6) | PIN por persona en tableta compartida |
| Trabajo sin internet y red local | Parcial | `src-astro/src/lib/{idbSync,offlineQueue,pairing,meshNet}.ts`, `src-astro/src/pages/pair.astro`. La malla P2P está apagada por defecto (`meshNet.ts`: sin señalización configurada no hay red) | Emparejar caja y cocina por QR en la misma red | Nodo local (edge-mesh / Xavier local) |

### 4.4 Carta pública y pedidos del comensal

| | |
|---|---|
| Estado | **Existe**. `src-astro/src/pages/[slug]/menu.astro` + `src-astro/src/components/menu/PublicMenu.svelte` + `src-astro/src/lib/publicMenuBySlug.ts` (solo platos públicos, descripciones internas filtradas). Pedido por WhatsApp con enlace `wa.me` (sin API de WhatsApp Business). Filtro de alérgenos declarados vía GOS (`src-astro/src/pages/api/menu-nutrition.ts`). Pedido en mesa: `src-astro/src/pages/table/[qrCode].astro`, `checkout.astro`, `order-confirmation/[orderId].astro`; guía de pedidos de invitado en `src-astro/src/middlewareGating.ts`. Ruta antigua `src-astro/src/pages/menu/[restaurantId].astro`. |
| Problema de costo | Cada visita a la carta hace SSR y `list()` de restaurante, categorías y platos; `list()` lee **un objeto R2 por registro** (`src-astro/src/lib/cloudflareVaultAdapter.ts`, `list`). Una carta de 50 platos ≈ 55 lecturas R2 clase B por visita y una petición del Worker. No hay caché (`Cache-Control`/Cache API: sin usos en `src-astro/src`). |
| v1 | **Carta publicada como instantánea**: al pulsar "Publicar" se genera un JSON público (solo campos públicos) y se guarda en R2 servido por CDN; la página de carta lo lee (1 objeto, cacheado). Foto, horario y "abierto ahora" en la cabecera. |
| Después | Seguimiento del pedido por el comensal (`GET /api/orders/confirm` está permitido en `middlewareGating.ts` pero **no existe la ruta**), pedido cifrado a la llave del restaurante (Fase 3), varios idiomas. |

### 4.5 Directorio y "Menús cerca de mí"

| | |
|---|---|
| Estado | **Falta**. Además, `src-astro/src/middleware.ts` envía `Permissions-Policy: ... geolocation=()`, que **bloquea** la geolocalización del navegador en todo el sitio; hay que cambiarlo a `geolocation=(self)` en la página de búsqueda. |
| v1 (Fase 2) | Índice estático por zona (geohash) servido desde CDN; filtros en el navegador: distancia, abierto ahora, tipo de cocina, precio, dieta, "tiene carta en Fize", "pide por WhatsApp". Detalle en [DIRECTORIO.md](DIRECTORIO.md). |
| Después | Páginas SEO por ciudad y barrio; mapa vectorial. |

### 4.6 Descubrimiento de negocios (OpenStreetMap)

| | |
|---|---|
| Estado | **Falta**. |
| Decisión | **No se hace scraping de Google Maps** (viola los Términos de Servicio de Google y expone a SWAL a acciones legales y bloqueos). La fuente principal es **OpenStreetMap** (licencia ODbL, gratis, exige atribución), procesada por lotes fuera de Cloudflare. Google Places API queda como fuente opcional de pago con tope de presupuesto, y no se recomienda (ver [DIRECTORIO.md](DIRECTORIO.md) §6). |
| v1 (Fase 2) | Ingesta semanal desde extracto de OSM, deduplicación, reclamo de ficha por el dueño, baja (opt-out) inmediata. |
| Legal | Publicar fichas de negocios que no se registraron toca la **Ley 1581 de 2012 (habeas data)** cuando el negocio es una persona natural (nombre propio, celular personal). **Revisión de abogado antes de publicar fichas no reclamadas.** Mientras tanto, el directorio puede salir solo con negocios registrados en Fize. |

### 4.7 Cuenta, privacidad y cifrado

| | |
|---|---|
| Estado | **Parcial**. Cada registro se sella (`src-astro/src/lib/cloudflareVaultAdapter.ts`: paquete cifrado en R2 + metadatos en D1 `sealed_meta`). La API SSR crea el adaptador con `serverReadable: true` (`src-astro/src/lib/storageAdapter.ts`), así que **las 3 partes de la llave quedan en la nube y el operador puede descifrar**. El modo E2EE existe (partes del dispositivo en IndexedDB, `src-astro/src/lib/deviceShareStore.ts`; sellado que falla cerrado sin almacén) pero el panel no lo usa. Contraseñas con PBKDF2-SHA256 (`src-astro/src/lib/auth/session.ts`). No encontré pantalla para exportar datos ni borrar la cuenta. No hay T&C ni política de privacidad publicadas. No hay librerías de analítica de terceros en `src-astro`. |
| v1 | Textos honestos (§5), política de privacidad y T&C (abogado, Ley 1581), exportar todo (JSON/CSV) y borrar cuenta. |
| Fase 3 | E2EE real para los datos operativos: el panel lee y escribe en el dispositivo; la nube guarda paquetes cifrados + 1 parte de la llave. Recuperación con código impreso o segundo dispositivo. |

### 4.8 Admin SWAL

| | |
|---|---|
| Estado | **Falta** como consola. Existe facturación compartida en `private/saas-backend/` y `private/cloud/src-astro/src/lib/{saas,saasUsage,billing}.ts` (modulo cloud). |
| v1 | Mínimo: cola de reclamos de fichas y bajas (opt-out) en D1, vista de cupos de Cloudflare. Sin acceso a datos operativos de los restaurantes. |
| Después | Métricas agregadas del servicio (nunca por restaurante sin permiso). |

## 5. Modelo de privacidad

### 5.1 Clases de datos

| Clase | Ejemplos | Quién lo ve | Hoy | Meta |
|-------|----------|-------------|-----|------|
| **A. Público por elección del dueño** | Nombre, carta pública, precios, fotos, ubicación, horarios, WhatsApp, tipo de cocina | Cualquiera | Sellado igual que lo privado y leído en cada visita | Instantánea pública en claro, cacheada en CDN. El dueño elige qué campos publica. |
| **B. Operativo privado** | Recetas, costos, inventario, compras, proveedores, ventas, analítica | Solo el restaurante | Cifrado en reposo, **legible por el operador** (`serverReadable`) | **E2EE**: se descifra solo en dispositivos del restaurante (Fase 3) |
| **C. Transaccional necesario** | Pedido de un comensal (platos, mesa, total, nota) | El restaurante; el servidor lo transporta | Legible por el servidor | Cifrado en el navegador del comensal con la llave pública del restaurante; el servidor guarda solo el paquete hasta que la cocina lo recoge (Fase 3) |
| **D. Cuenta** | Correo, hash de contraseña, sesiones, pertenencia a un restaurante | El servidor (para autenticar) | Igual | Igual, mínimo posible |
| **E. Visitante del directorio** | Ubicación | Nadie: se calcula en el navegador | No aplica | Solo se pide la zona aproximada (geohash de ~5 km) al CDN; nunca coordenadas exactas |
| **F. Telemetría técnica** | Errores, versión de la app | SWAL, si el dueño acepta | No hay | Desactivada por defecto; se activa con aceptación explícita en T&C; sin contenido de negocio |

**Pedidos por WhatsApp:** pasan por WhatsApp (Meta), no por Fize. La carta lo dice al comensal.

### 5.2 Texto permitido hoy (hasta Fase 3)

- Sí: "Tus datos se guardan cifrados desde el primer registro." · "No vendemos ni usamos tus datos." · "Sin publicidad ni rastreo." · "Puedes exportarlos y borrarlos."
- Sí, obligatorio en la página de privacidad: "Hoy SWAL custodia las llaves para que Fize funcione en la nube. Estamos moviendo las llaves a tus dispositivos; cuando termine, ni SWAL podrá leer tus recetas, costos ni ventas."
- No: "Cifrado de extremo a extremo", "solo tú puedes leerlos", "conocimiento cero".

### 5.3 Cómo se sostiene "gratis" sin vender datos (opciones, no decisión)

| Opción | Qué es | Ventaja | Riesgo |
|--------|--------|---------|--------|
| Núcleo gratis + **Socio** opcional | Ya existe el tier `socio` (`src-astro/src/middlewareGating.ts`, `private/saas-backend/`). Cobrar solo lo que cuesta: respaldo/sincronización gestionada, IA, dominio propio, varias sedes | Coherente con P1 | Hay que cuidar que lo básico no se degrade |
| Red SWAL | El restaurante aporta un nodo local (PC o celular viejo) que guarda sus datos y sirve a la red | Baja el costo de nube | Requiere edge-mesh maduro |
| Servicios | Implementación presencial, impresión de QR, capacitación | Ingreso inmediato | Escala con personas |
| Patrocinio institucional | Cámaras de comercio, alcaldías, programas de seguridad alimentaria | Alinea con la misión | Dependencia de terceros |
| Donaciones | Botón voluntario | Simple | Ingreso bajo |
| Publicidad | un plan interno de anuncios propone anuncios para tier gratuito | — | **Contradice la promesa**. No recomendado; si algún día, solo contextual, sin rastreo y fuera del panel |

## 6. Multi-tenant (varios restaurantes en una plataforma)

### 6.1 Hoy

- Un despliegue = una instancia. `instance_id` sale de `?instance_id=` o de `domainConfig.instanceId` (`'default'` salvo que el build fije `PUBLIC_FIZE_INSTANCE_ID`) (`src-astro/src/lib/domain.config.ts`, `src-astro/src/middleware.ts`, y se repite en cada página/endpoint).
- Usuarios y sesiones viven dentro de la instancia (`src-astro/src/lib/auth/session.ts`).
- Endpoints públicos aceptan `?instance_id=` (ej. `GET /api/restaurants`), lo que permite listar restaurantes de otra instancia.
- Sin control por rol.

### 6.2 Meta

| Pieza | Diseño |
|-------|--------|
| Instancia | Una por restaurante (o grupo). Identificador opaco, no derivable del nombre. |
| Registro de instancias | Tabla D1 `tenant(instance_id PK, slug UNIQUE, owner_user_id, status, created_at)`. |
| De dónde sale la instancia | **Rutas privadas:** de la sesión, nunca de la URL. El token de sesión lleva el prefijo de instancia (`<instance>.<aleatorio>`) para resolverla sin consulta extra. **Rutas públicas:** del slug (`/{slug}/menu` → `tenant.slug`) o del host más adelante (un solo nivel, ej. `fize-<slug>.swal.network`: el certificado gratuito de Cloudflare cubre `*.swal.network` pero **no** `*.fize.swal.network`). `?instance_id=` se elimina. |
| Identidad | Un correo puede pertenecer a varios restaurantes: tabla `membership(user_id, instance_id, role)`. |
| Roles | `owner`, `staff` (sala), `cocina`, `caja`. Matriz abajo. |
| Datos | Ya están separados por `appId + instance_id` en `sealed_meta`: no hay que re-cifrar para migrar. |

Matriz de permisos (v1):

| Acción | owner | caja | staff | cocina |
|--------|:-----:|:----:|:-----:|:------:|
| Editar carta y precios, publicar | ✔ | | | |
| Ver costos, recetas completas, compras, proveedores | ✔ | | | |
| Ver receta de preparación (pasos y cantidades) | ✔ | | | ✔ |
| Crear/editar pedidos, mesas | ✔ | ✔ | ✔ | |
| Cambiar estado de comanda (en preparación/listo) | ✔ | | ✔ | ✔ |
| Registrar cobros, cierre de caja | ✔ | ✔ | | |
| Inventario: ver / ajustar | ✔ | ver | | ver |
| Analítica y ventas | ✔ | día actual | | |
| Personal, ajustes, exportar, borrar | ✔ | | | |

### 6.3 Ruta de migración

1. **Fase 0 (cliente hoy):** despliegue dedicado con instancia propia. Worker aparte (`fize-<slug>`, nombre único en la cuenta) compilado con `PUBLIC_FIZE_INSTANCE_ID=<slug>`, mismo D1/R2/KV, subdominio de un solo nivel (`fize-<slug>.swal.network` o `<slug>.swal.network`). Costo: 1 de los 100 Workers de la cuenta, 0 crons, 0 KV extra; las peticiones salen del mismo cupo diario. **Hecho (develop, 2026-10-02):** `private/infra/scripts/deploy-tenant.sh` y `instanceId` leído de `PUBLIC_FIZE_INSTANCE_ID` en `src-astro/src/lib/domain.config.ts`. Evitar `<slug>.fize.swal.network`: el certificado gratuito (Universal SSL) solo cubre un nivel de subdominio.
2. **Fase 1:** comprobar rol en servidor (matriz de §6.2) y quitar `?instance_id=` de rutas privadas.
3. **Fase 2:** tablas `tenant` y `membership`; instancia desde la sesión o el slug; slug único global; un solo Worker multi-tenant. Cada despliegue dedicado se migra registrando su `instance_id` en `tenant` y apuntando su subdominio al Worker común. Luego se borra el Worker dedicado (`wrangler delete`).

## 7. Hoja de ruta

Esfuerzo: **S** ≤ 1 día · **M** 2–5 días · **L** 1–3 semanas.

### Fase 0 — "Cliente hoy" (1–2 días)

| # | Entrega | Esf. | Depende de |
|---|---------|:----:|-----------|
| 0.1 | ✅ 2026-10-02 · Despliegue dedicado para el cliente (Worker propio, instancia propia, subdominio de un nivel): `private/infra/scripts/deploy-tenant.sh <slug> [hostname]`, probado de punta a punta con un inquilino temporal (aislamiento de datos, sesión y carta) | S | Decisión 1 |
| 0.2 | ✅ 2026-10-02 · Migración `src-astro/migrations/003_sealed_meta_cloud_share.sql` aplicada en el D1 de producción | S | — |
| 0.2b | ✅ 2026-10-02 · Registro cerrado (antes cualquiera entraba como staff con poderes de dueño); SW con red primero (antes mostraba "Sin conexión" a todo el que volvía); `/api/menu-nutrition` público; lecturas sin re-sellado | S | — |
| 0.3 | Campo **WhatsApp** en `RestaurantForm.svelte` (la API ya lo acepta) | S | — |
| 0.4 | Validar slug (formato, reservados) y rechazar duplicados dentro de la instancia | S | — |
| 0.5 | Onboarding asistido por SWAL con las pantallas actuales ([ONBOARDING.md](ONBOARDING.md) §2) | S | 0.1–0.4 |
| 0.6 | Hoja imprimible de QR de mesas | S | — |
| 0.7 | Revisar textos de privacidad en la interfaz actual según §5.2 | S | — |

### Fase 1 — Onboarding y carta barata (2–3 semanas)

| # | Entrega | Esf. | Depende de |
|---|---------|:----:|-----------|
| 1.1 | Landing nueva prerenderizada ([LANDING.md](LANDING.md)) sobre PR #353 | M | Merge #353 |
| 1.2 | Asistente de onboarding de 6 pasos | L | 0.3, 0.4 |
| 1.3 | Perfil público: ubicación (mapa), horarios, tipo de cocina, rango de precio | M | 1.2 |
| 1.4 | Carta publicada como instantánea JSON en R2 + CDN; `/{slug}/menu` la lee | M | — |
| 1.5 | Personal: pantalla, invitación con enlace, roles y comprobación en servidor | M | — |
| 1.6 | Plantillas de carta (corrientazo, comidas rápidas, cafetería, panadería, asadero, pizzería) | S | 1.2 |
| 1.7 | Exportar datos y borrar cuenta | M | — |
| 1.8 | T&C y política de privacidad (Ley 1581) | M | Abogado |
| 1.9 | KDS: red local si está emparejado; nube cada 60 s como respaldo | M | — |

### Fase 2 — Multi-tenant y directorio (3–5 semanas)

| # | Entrega | Esf. | Depende de |
|---|---------|:----:|-----------|
| 2.1 | Tablas `tenant` y `membership`, instancia desde sesión/slug, slug global | L | 1.5 |
| 2.2 | Migrar despliegues dedicados al Worker común | M | 2.1 |
| 2.3 | Índice del directorio por geohash (negocios Fize) en R2 + CDN | M | 1.3, 1.4 |
| 2.4 | Página "Menús cerca de mí" prerenderizada con filtros en el navegador; `geolocation=(self)` | M | 2.3 |
| 2.5 | Ingesta OSM por lotes (fuera de Cloudflare) | M | Decisión 3 |
| 2.6 | Reclamo de ficha y baja (opt-out); cola en admin SWAL | M | 2.5, abogado |

### Fase 3 — E2EE real y local primero (4–6 semanas)

| # | Entrega | Esf. | Depende de |
|---|---------|:----:|-----------|
| 3.1 | Panel en el cliente: lee/escribe IndexedDB; la nube solo sincroniza paquetes cifrados | L | 2.1 |
| 3.2 | Llave en dispositivos (`deviceShareStore.ts`), emparejar dispositivos, código de recuperación | L | 3.1 |
| 3.3 | Pedidos del comensal cifrados a la llave pública del restaurante | M | 3.2 |
| 3.4 | Cambiar textos a "solo tú puedes leerlos" tras auditoría | S | 3.1–3.3 |

### Fase 4 — Después

Importar carta desde foto/PDF/texto (IA con cupo) · APK Flutter + PWA sobre el mismo core · nodo local edge-mesh/Xavier · varias sedes · modificadores y combos · enriquecimiento opcional de pago (Google Places) · registro de comidas hacia OrionHealth (contrato `swal.health/v1`).

## 8. Fuera de alcance (no-objetivos)

- Scraping de Google Maps o de cualquier sitio que lo prohíba.
- Vender, alquilar o "anonimizar y monetizar" datos de restaurantes o comensales.
- Publicidad con rastreo, píxeles o analítica de terceros.
- Procesar pagos en línea o retener dinero (Fize solo **registra** cobros).
- Facturación electrónica DIAN en v1 (se evalúa integración con un proveedor autorizado más adelante).
- Domicilios con repartidores propios o comisiones por pedido.
- Reseñas y calificaciones públicas (moderación y riesgo legal).
- Posiciones pagadas en el directorio.
- App nativa en v1 (PWA primero; APK en Fase 4).

## 9. Riesgos principales

| Riesgo | Mitigación |
|--------|-----------|
| Agotar el cupo gratuito compartido (100.000 peticiones/día, 10 M lecturas R2 clase B/mes) | Con la arquitectura de hoy, un restaurante activo gasta ~3.000 peticiones/día solo en el KDS y ~55 lecturas R2 por visita a la carta: el techo práctico es de **~25–30 restaurantes activos**. Fases 1.4, 1.9 y 2.3 lo bajan a cientos de peticiones por restaurante. |
| Promesa de cifrado mal entendida | Textos de §5.2; E2EE real en Fase 3. |
| Fichas OSM de negocios no registrados | Solo datos públicos, reclamo y baja visibles, revisión legal (Ley 1581). |
| Secuestro de una ficha por un competidor | Reclamo verificado por SWAL antes de fusionar con la ficha OSM ([DIRECTORIO.md](DIRECTORIO.md) §5). |
| Pérdida de datos al pasar a E2EE (dispositivos perdidos) | Código de recuperación impreso, segundo dispositivo, advertencia clara. |
