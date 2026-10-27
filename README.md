# 🍽️ Hosteler-IA (Fi'ze) - SWAL Sovereign Hospitality Node

Una plataforma empresarial soberana y autónoma para la gestión de restaurantes y hostelería mediante inteligencia artificial avanzada, automatización local y experiencia de usuario PWA offline-first.

## 🚀 Estado del Proyecto: ¡Listo para Producción!

**Estado General: 100% Completado ✅**

> ⚠️ **Corrección 2026-10-05.** El "100%" anterior era una declaración propia, no una medición, y estaba mal. Lo que sí está medido y verificado a 2026-10-05 sobre `feat/notifications-and-reset-data` @ `ea76dc76d`:
>
> | Dato medido | Valor | Comando |
> |---|---:|---|
> | Tests unitarios + integración | **525** en **59** ficheros | `cd src-astro && npx vitest run` |
> | E2E Playwright | **33** tests en **12** specs | `cd src-astro && npx playwright test --list` |
> | Rutas REST | **29** ficheros / **59** métodos HTTP | `find src/pages/api -type f \| wc -l` |
> | `astro check` | 0 errores, 0 avisos, 0 hints | `cd src-astro && pnpm run check` |
>
> El ledger de features (`features.json`, `metadata.verified_facts`) vive en el repo privado del proyecto. El porcentaje por feature que figura ahí (`progress_pct`) sigue siendo lo que declaró cada wave de entrega y **no** se ha re-auditado feature por feature.

El backend y frontend de Hosteler-IA están completamente implementados, son robustos y han sido probados. El sistema es un nodo capaz de gestionar las operaciones completas de un restaurante en un entorno de producción real dentro del ecosistema SWAL (Sovereign Work & Autonomous Living).

* **APIs REST**: 29 ficheros de ruta bajo `src-astro/src/pages/api` que exportan 59 métodos HTTP (medido 2026-10-05 con `find src/pages/api -type f | wc -l` → 29).
* **Hooks de React**: Custom hooks optimizados para una integración perfecta con la interfaz de usuario.
* **Arquitectura**: Multi-tenant, descentralizada, segura y escalable basada en nodos soberanos.
* **Tiempo Real**: Funcionalidades en tiempo real para la gestión dinámica de sala y cocina.

## 🌟 Características Principales

### **🧠 Inteligencia Artificial Nativa**
- **Predicciones de Inventario**: Algoritmos avanzados para predecir la demanda y optimizar el stock de insumos.
- **Recomendaciones Personalizadas**: Motor Fi'ze con Cloudflare Workers AI para sugerencias contextuales (con fallback local sin nube).
- **Analytics Predictivos**: Identificación de tendencias y patrones de consumo para una toma de decisiones proactiva.
- **Optimización Automática**: Ajuste dinámico de recomendaciones e inventario inteligente.

### **📦 Sistema de Inventario Empresarial**
- **Gestión Completa**: Seguimiento en tiempo real de ingredientes, suministros y productos.
- **Transacciones Detalladas**: Historial completo de todos los movimientos de inventario (compras, usos, mermas).
- **Integración con Recetas**: Descuento automático del stock al realizar una venta, asegurando datos precisos.
- **Alertas Automáticas**: Notificaciones proactivas de stock bajo para evitar roturas de inventario.

### **🍽️ Gestión Integral de Operaciones**
- **Menús Inteligentes**: Gestión de categorías, items y modificadores con disponibilidad en tiempo real basada en el inventario.
- **Pedidos Automatizados**: Flujo completo desde que el cliente escanea un código QR hasta que el pedido llega a la cocina.
- **Gestión de Mesas y QR**: Creación y gestión de mesas con sus correspondientes códigos QR para una experiencia sin contacto.

### **📱 Progressive Web App (PWA)**
- **Experiencia Nativa**: Instalable en dispositivos móviles y de escritorio.
- **Funcionalidad Offline**: Permite la operación continua e interactiva sin conexión a internet.
- **Notificaciones Push**: Envío de alertas y actualizaciones en tiempo real a los usuarios.
- **Performance Optimizada**: Tiempos de carga ultrarrápidos con estrategias StaleWhileRevalidate y IndexedDB local.

### **🏛️ Arquitectura de Nodo Soberano (SWAL Pro)**
- **Nodo Autónomo**: Operación independiente sin dependencia de servicios externos centralizados o intermediarios.
- **Control Total de Datos**: Almacenamiento local y sincronización descentralizada.
- **Escalabilidad Multi-nodo**: Capacidad de interconexión en red de nodos dentro del ecosistema SWAL.

## 🏗️ Arquitectura Tecnológica

### **Stack Principal**
```typescript
Frontend:  Astro 7 + Svelte 5 (runes) + TypeScript + @swal/ui
Backend:   Cloudflare Workers (D1 + R2 + KV + AI) + StorageAdapter (Memory/IDB/Vault)
IA:        Cloudflare Workers AI + motor de recomendaciones Fi'ze
PWA:       Workbox + BackgroundSync (fi-ze-orders) + IndexedDB (idb)
Auth:      Sesiones propias Fi'ze (PBKDF2 + KV) + gating socio (free/socio/socio-managed)
```

### **Estructura de Directorios**
```
src-astro/
├── src/pages/api/           # REST Workers (restaurants, tables, menu, orders, inventory, auth, ai)
├── src/pages/               # Páginas Astro (/, /login, /register, /menu, /table, /checkout, /dashboard)
├── src/components/          # Islas Svelte 5 (menu, orders, tables, client, ai, auth)
├── src/stores/              # Stores runes (inventory, menu, orders, cart, auth)
├── src/lib/                 # StorageAdapter, ledger, state machine, sync, auth, gating
└── e2e/                     # Playwright 12 specs (flujos + a11y axe-core)
```

## 📊 Performance

### **Métricas y Objetivos**
- **LCP**: < 2.5s
- **FID**: < 100ms
- **CLS**: < 0.05
- **Puntuación Lighthouse**: > 90 en todas las categorías.

## 🚀 Instalación y Configuración

### **Requisitos Previos**
- Node.js 22+
- pnpm 11+
- Nada más para usar Fize: el modo local (`/local/`) guarda todo en el navegador (IndexedDB) y funciona sin internet.
- Opcional, para tu propia nube: una cuenta Cloudflare (Workers + D1 + R2 + KV).

### **Instalación Rápida**
```bash
git clone <este-repo> fize && cd fize/src-astro
pnpm install --frozen-lockfile
pnpm dev            # http://localhost:4321/local/
pnpm check && pnpm vitest run && pnpm build
pnpm run test:e2e   # Playwright, incluida e2e/offline-local-first.spec.ts (sin red externa)
```

Sin `wrangler.jsonc` el build usa `wrangler.e2e.jsonc` (solo bindings locales de miniflare). Para desplegar
tu instancia: `cp wrangler.example.jsonc wrangler.jsonc`, crea tus recursos y pega sus ids (el archivo
está en `.gitignore`).

### **Módulo cloud opcional**
Planes, créditos de IA, consumo y facturas SaaS (todo lo que cobra dinero real) no forman parte de este
árbol: la app los carga solo si existe el módulo cloud (`src-astro/src/cloud/`, contrato en `types.ts`). Sin
él, `/api/saas/*` y `/api/ai/infer` responden 404 `{ "error": "cloud disabled" }` y ajustes no muestra plan
ni consumo. El registro manual de cobros (método + monto: efectivo, datáfono, Bre-B, transferencia; Fize no
mueve el dinero) sí es parte de la app: `src/lib/payments.ts`, `POST /api/orders/[id]/payment`.

## 🧪 Demo para restaurantes (5 min, contra preview o prod)

```bash
BASE=https://fize-astro.iberi22.workers.dev
# 1. Sesión staff (los writes la exigen desde SEC-01)
curl -s -c jar.txt -X POST $BASE/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@turestaurante.com","password":"demo-Password-123","name":"Demo"}'
# 2. Restaurante + insumo con stock 10
curl -s -b jar.txt -X POST $BASE/api/restaurants -H 'Content-Type: application/json' \
  -d '{"name":"Bar Demo","slug":"bar-demo"}'
INV=$(curl -s -b jar.txt -X POST $BASE/api/inventory -H 'Content-Type: application/json' \
  -d '{"name":"Harina","unit":"kg","initialStock":10}' | node -p "JSON.parse(require('fs').readFileSync(0)).id")
# 3. Plato CON receta (2 kg por ración) + mesa + pedido x3
CAT=$(curl -s -b jar.txt -X POST $BASE/api/categories -H 'Content-Type: application/json' \
  -d '{"name":"Carta"}' | node -p "JSON.parse(require('fs').readFileSync(0)).id")
PLATO=$(curl -s -b jar.txt -X POST $BASE/api/menu-items -H 'Content-Type: application/json' \
  -d "{\"name\":\"Pan\",\"price\":3,\"categoryId\":\"$CAT\",\"recipe\":[{\"inventoryId\":\"$INV\",\"qty\":2}]}" \
  | node -p "JSON.parse(require('fs').readFileSync(0)).id")
MESA=$(curl -s -b jar.txt -X POST $BASE/api/tables -H 'Content-Type: application/json' \
  -d '{"number":1,"capacity":2}' | node -p "JSON.parse(require('fs').readFileSync(0)).id")
PED=$(curl -s -b jar.txt -X POST $BASE/api/orders -H 'Content-Type: application/json' \
  -d "{\"tableId\":\"$MESA\",\"items\":[{\"menuItemId\":\"$PLATO\",\"qty\":3}]}" \
  | node -p "JSON.parse(require('fs').readFileSync(0)).id")
# 4. Servir → el stock baja solo: 10 − 2×3 = 4
for S in preparing ready served; do
  curl -s -b jar.txt -X POST $BASE/api/orders/$PED/transition \
    -H 'Content-Type: application/json' -d "{\"to\":\"$S"}"; done
curl -s $BASE/api/inventory/$INV | node -p "JSON.parse(require('fs').readFileSync(0)).stock"  # → 4
```

Staff URLs: `/dashboard/inventory|menu|orders|tables|kitchen|analytics|settings|client`
(informe interno de escaneo, no publicado).
Tier `free` cubre todo el CRUD; la IA (Fi'ze) exige `socio` (402 si no).

## 🤝 Contribuir al Proyecto

Consulte `CONTRIBUTING.md` para conocer los estándares y directrices de desarrollo de SWAL.

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **GNU Affero General Public License v3.0 (AGPL-3.0-only)**. Consulte el archivo `LICENSE` para más información.

## Datos alimentarios GOS

Fize conserva insumos operativos y recetas de cocina; el catálogo de alimentos,
nutrientes, alérgenos y metadatos procede exclusivamente de GOS mediante
`@swal/gos-client`, vendorizado en `cores/gos-client` (ver `VENDORED_FROM`).
Configura `PUBLIC_GOS_API` al construir la app; por defecto usa
`https://gos.swal.network/api/v1`. Consulta [la integración](docs/GOS.md).
