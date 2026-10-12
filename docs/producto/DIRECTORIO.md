# Fize — Directorio y "Menús cerca de mí"

> Fecha: 2026-10-02. Parte de [ALCANCE.md](ALCANCE.md). Fase 2 de la hoja de ruta.
> Estado hoy: **no existe**. Además `src-astro/src/middleware.ts` envía `Permissions-Policy: ... geolocation=()`,
> que bloquea la geolocalización del navegador; la página de búsqueda necesita `geolocation=(self)`.

---

## 1. Qué es

Una página pública, sin cuenta y sin cookies, donde cualquiera ve negocios de comida cercanos, filtra y
abre su carta. Dos fuentes:

| Fuente | Qué aporta | Cuándo se actualiza |
|--------|-----------|---------------------|
| **Fize** | Restaurantes registrados que eligieron aparecer (paso 6 del onboarding) | Al publicar |
| **OpenStreetMap** | Negocios de comida que existen en OSM, registrados o no en Fize | Lote semanal |

## 2. Modelo de datos

La ficha pública y los datos privados del restaurante son **cosas separadas**. El índice del directorio
nunca se arma leyendo el vault: se arma con lo que el dueño publicó y con OSM.

### 2.1 `PublicListing` (lo único que sale al directorio)

| Campo | Tipo | Fuente | Notas |
|-------|------|--------|-------|
| `id` | string | Fize: `fz:<slug>` · OSM: `osm:n123` / `osm:w456` | Estable |
| `name` | string | Dueño / OSM `name` | Obligatorio |
| `lat`, `lon` | número, 5 decimales (~1 m) | Pin del dueño / OSM (centroide si es un polígono) | |
| `kind` | enum | `restaurant`, `cafe`, `fast_food`, `bar`, `bakery`, `food_court`, `ice_cream` | De `amenity`/`shop` de OSM |
| `cuisine` | string[] (≤ 3) | Dueño / OSM `cuisine` (separado por `;`) | Lista cerrada, ver [ONBOARDING.md](ONBOARDING.md) paso 2 |
| `price` | 1–3 | Solo dueño | OSM no lo trae de forma fiable |
| `hours` | 7 listas de franjas `[inicio, fin]` en minutos, hora de Bogotá | Dueño / OSM `opening_hours` procesado en el lote | Si no se puede interpretar: ausente ("horario no disponible") |
| `diet` | `veg`, `vegan`, `gluten_free`… | OSM `diet:*=yes|only` / dueño | Declaración del negocio, no certificación |
| `gos` | bool | Fize | La carta tiene platos con información de alérgenos de GOS |
| `menuUrl` | string | Fize | `/{slug}/menu` |
| `wa` | bool | Fize | Tiene botón de WhatsApp (el número va en la carta, no en el índice) |
| `table` | bool | Fize | Acepta pedido en mesa |
| `src` | `fize` \| `osm` | — | Para la atribución |
| `claimed` | bool | — | Ficha OSM verificada por su dueño |

**Nunca entran al índice:** teléfonos, correos o sitios web de fichas OSM no reclamadas (ver §7),
recetas, costos, inventario, ventas, `instance_id`, datos de cuenta.

### 2.2 Tablas de control (D1, pocas filas)

| Tabla | Para qué |
|-------|----------|
| `listing_claim(osm_ref, instance_id, status, evidence_ref, created_at, decided_at)` | Reclamos de fichas OSM |
| `listing_optout(osm_ref, reason, created_at)` | Bajas; el lote las respeta siempre |
| `tenant(... directory BOOLEAN, geohash5 TEXT)` | Qué restaurantes Fize aparecen y en qué celda |

## 3. Búsqueda por ubicación sin costo de backend

### 3.1 Índice estático por celdas

- El mapa se divide en celdas **geohash de 5 caracteres** (~4,9 × 4,9 km en el ecuador).
- Por cada celda con negocios hay un archivo JSON comprimido: `dir/v1/<geohash5>.json` con sus `PublicListing`.
- Hay dos capas que el navegador une: `dir/v1/osm/<gh5>.json` (lote semanal) y `dir/v1/fize/<gh5>.json` (se reescribe al publicar un restaurante de esa celda). Una ficha OSM reclamada se oculta en la capa OSM y aparece en la Fize.
- `dir/v1/manifest.json`: versión, fecha del lote, lista de celdas existentes, atribución ODbL.
- `dir/v1/suppress.json`: bajas recientes que aún no entraron al lote (el navegador las filtra).

### 3.2 Dónde se sirven

**Recomendado:** bucket R2 con dominio propio (ej. `datos.fize.swal.network`) y regla de caché "cachear todo"
(capa OSM: 1 día; capa Fize y `suppress.json`: 10 min). Las respuestas en caché **no invocan el Worker**
(no gastan del cupo de 100.000 peticiones/día) y solo leen R2 cuando la caché falla.

Alternativa: assets estáticos del Worker (`dist/client`), que tampoco invocan el Worker, pero exigen
redesplegar para actualizar y tienen límite de archivos por versión. Sirve para la capa OSM si R2 con dominio no es viable.

La página `/cerca` es **prerenderizada** (`export const prerender = true`): HTML estático, sin SSR.

> No usar `r2.dev` en producción (tiene límite de tasa). Verificar los límites vigentes de assets y R2 en la
> documentación de Cloudflare antes de implementar.

### 3.3 Flujo en el navegador

1. El visitante pulsa "Usar mi ubicación" (o elige ciudad/barrio a mano; no es obligatorio dar ubicación).
2. El navegador obtiene coordenadas con `navigator.geolocation` y **calcula el geohash en el dispositivo**.
3. Pide `manifest.json` y las celdas de su zona: la suya + las 8 vecinas (radio útil ~5–7 km). Para "más lejos", el siguiente anillo.
4. Distancia (haversine), "abierto ahora", filtros y orden se calculan en el navegador.
5. Al abrir una ficha Fize se va a `/{slug}/menu` (carta publicada, también cacheada).

### 3.4 Privacidad de la ubicación del visitante

| Qué | Garantía |
|-----|----------|
| Coordenadas exactas | No salen del dispositivo |
| Lo que ve la red | Solo el nombre de las celdas pedidas (~5 km). Lo ve la CDN de Cloudflare como cualquier petición; el Worker de Fize no participa |
| Modo "más privado" | Elegir ciudad a mano: se descargan todas las celdas de la ciudad, sin revelar el barrio |
| Cookies, cuentas, identificadores | Ninguno |
| Registro de búsquedas o clics | Ninguno |
| Recordar la última zona | Opcional, en `localStorage` del visitante |

## 4. Filtros

| Filtro | Fuente | Disponible para | Comentario |
|--------|--------|-----------------|-----------|
| Distancia (1, 3, 5, 10 km) | Calculada en el navegador | Todos | |
| Abierto ahora | `hours` + hora de Bogotá | Fichas con horario | Sin horario → se muestran al final con "horario no disponible" |
| Tipo de cocina | `cuisine` | Todos | Multi-selección |
| Tipo de negocio | `kind` | Todos | Restaurante, cafetería, panadería, comidas rápidas… |
| Precio ($, $$, $$$) | `price` | Solo Fize | |
| Dieta (vegetariano, vegano, sin gluten) | `diet` | Todos | Lo declara el negocio; Fize no lo certifica |
| Alérgenos | Carta con GOS (`gos=true`) | Solo Fize | En el directorio solo se filtra "carta con información de alérgenos". El filtro plato por plato ("ocultar platos con maní") ocurre dentro de la carta (`src-astro/src/components/menu/PublicMenu.svelte`). **Una lista vacía no certifica ausencia de alérgenos** (`docs/GOS.md`) |
| Tiene carta en Fize | `src`, `menuUrl` | Todos | |
| Pide por WhatsApp / en mesa | `wa`, `table` | Solo Fize | |

## 5. Ranking (sin vender datos ni posiciones)

1. Orden por defecto: **distancia** ascendente.
2. Si está activo "abierto ahora", los cerrados no aparecen; si no, los abiertos van primero.
3. Empates (misma distancia redondeada a 100 m): orden por `hash(id + fecha del día)`, que rota cada día y no favorece a nadie de forma permanente.
4. Opciones de orden: distancia, precio.
5. **No hay** posiciones pagadas, "destacados" ni orden por popularidad (exigiría medir visitas).

## 6. Fuentes: por qué OpenStreetMap y no Google Maps

| Opción | Legal | Costo | Encaja con índice estático | Recomendación |
|--------|-------|-------|---------------------------|---------------|
| Scraping de Google Maps | **No**: viola los Términos de Servicio de Google; riesgo de bloqueo y de demanda | "Gratis" hasta que bloquean | — | **Descartado** |
| Google Places API | Sí, con contrato | Se paga por cada consulta | **No**: los términos de Google Maps Platform restringen guardar en caché el contenido de Places (en general solo el `place_id` se puede guardar sin límite) | Solo opcional, para enriquecer fichas **reclamadas** con permiso del dueño, con tope de presupuesto mensual fijo y alarma. No en v1. Verificar términos vigentes |
| **OpenStreetMap** (extracto Geofabrik / Overpass / Nominatim) | Sí, licencia **ODbL**: exige atribución y compartir bajo ODbL la base derivada | Gratis | Sí | **Fuente principal** |
| Reclamo y registro del dueño | Sí (consentimiento) | Gratis | Sí | Fuente de mayor calidad |

## 7. Pipeline de ingesta OSM (por lotes, fuera de Cloudflare)

Corre **semanalmente** en GitHub Actions programado o en un nodo SWAL (Xavier/Hermes). **No** usa los cron
triggers de Cloudflare (5 por cuenta, compartidos) ni corre por petición de usuario.

| Paso | Qué hace | Herramienta |
|------|----------|-------------|
| 1. Descargar | Extracto de Colombia de Geofabrik (`south-america/colombia-latest.osm.pbf`). Para un piloto de una sola ciudad basta una consulta Overpass por bbox, respetando su política de uso | `curl` |
| 2. Filtrar | `amenity=restaurant,cafe,fast_food,food_court,ice_cream,bar,pub` y `shop=bakery,pastry,confectionery`. `bar`/`pub` solo si tienen `food=yes` o `cuisine` | `osmium tags-filter` |
| 3. Normalizar | Centroide de polígonos; `name` obligatorio; `cuisine` a la lista cerrada; `diet:*`; `opening_hours` a franjas (si no se puede interpretar, se omite) | Script (Python o Node) |
| 4. Deduplicar | Por `osm_ref` (tipo + id). Duplicados internos: mismo nombre normalizado a < 30 m → uno. Contra Fize: ficha reclamada → se oculta la OSM; restaurante Fize sin reclamo con nombre parecido (similitud ≥ 0,85) a < 75 m → se **sugiere** al dueño reclamar, no se fusiona solo | Script |
| 5. Suprimir | Aplica `listing_optout` (todas las bajas, siempre) | Script |
| 6. Construir celdas | Agrupa por geohash5, escribe JSON + `manifest.json` con atribución | Script |
| 7. Publicar | Compara con el lote anterior y sube **solo las celdas que cambiaron** a R2 | `wrangler r2 object put` / API S3 |

Atribución visible en la página y en cada archivo: "Datos de negocios © colaboradores de OpenStreetMap, ODbL".
La capa OSM publicada es una base derivada de OSM: se ofrece bajo ODbL. Los datos que aporta cada dueño se
mantienen en la capa Fize, separada, para no mezclar licencias (confirmar con abogado).

### 7.1 Ficha de un negocio no registrado

Muestra solo: nombre, tipo, cocina, distancia/ubicación, horario si OSM lo tiene, la etiqueta "Datos de
OpenStreetMap" y dos enlaces: **"¿Es tu negocio? Reclámalo gratis"** y **"Quitar este negocio de Fize"**.
No muestra teléfono, correo ni sitio web aunque OSM los tenga: en un negocio de persona natural pueden ser
datos personales.

## 8. Reclamo y baja (opt-out)

### 8.1 Reclamar una ficha OSM

1. "¿Es tu negocio?" → `/registrar?reclamar=osm:n123` → onboarding con nombre, ubicación, cocina y horario precargados.
2. El restaurante funciona en Fize **de inmediato** con su propia ficha (es su declaración). Lo que espera verificación es **reemplazar** la ficha OSM, para que nadie se apropie de la de un competidor.
3. Verificación v1 (manual, poco volumen): foto de la fachada con un código que Fize muestra en pantalla + RUT o certificado de Cámara de Comercio. Revisa el admin SWAL. La evidencia se borra al decidir.
4. Aprobado → `claimed=true`, la ficha OSM se oculta y queda la ficha Fize con su carta.

### 8.2 Quitar un negocio

- Formulario de 1 paso: motivo opcional. Escribe 1 fila en `listing_optout` (D1) y actualiza `suppress.json` en R2: la ficha desaparece en ≤ 10 min, sin esperar al lote.
- Si la ficha fue reclamada, solo el dueño puede quitarla (desde Ajustes).
- Una baja nunca se revierte sola en el siguiente lote.
- Riesgo aceptado: alguien puede ocultar la ficha OSM de un competidor no registrado. El daño es bajo (solo deja de verse en Fize) y el dueño real puede reclamarla.

## 9. Legal (revisión de abogado antes de publicar fichas no reclamadas)

- **Ley 1581 de 2012 y Decreto 1377 de 2013 (habeas data):** los datos de una persona jurídica no son datos personales, pero un negocio de persona natural (nombre propio, celular personal) sí puede tenerlos. Por eso: solo datos públicos mínimos, sin contacto, baja inmediata y fácil, aviso de privacidad visible.
- **ODbL:** atribución y licencia de la base derivada.
- **Términos de Google:** no se usa ningún contenido de Google Maps.
- Hasta tener concepto legal: el directorio sale **solo con restaurantes registrados en Fize** y la capa OSM se usa internamente para el reclamo precargado.

## 10. Costo estimado en el plan gratuito de Cloudflare

Supuestos: 30.000 fichas OSM en Colombia (cifra a medir en la primera corrida), ~150 bytes por ficha,
celdas de ~20–60 KB comprimidas en zonas densas, 5.000 búsquedas/día con 10 archivos cada una, 90 % de aciertos de caché.

| Recurso | Uso | Cupo gratuito (cuenta) | Peso |
|---------|-----|------------------------|------|
| Peticiones al Worker | 0 por búsqueda (página prerenderizada + archivos en CDN). Reclamos y bajas: decenas/día | 100.000/día | ~0 % |
| CPU del Worker | 0 por búsqueda | 10 ms/petición | — |
| R2 lecturas (clase B) | ~5.000 × 10 × 10 % fallos = ~5.000/día ≈ 150.000/mes | 10 M/mes | ~1,5 % |
| R2 escrituras (clase A) | Lote semanal: solo celdas cambiadas (cientos). Publicaciones Fize: 1 por cambio | 1 M/mes | < 0,5 % |
| R2 almacenamiento | Índice completo < 10 MB | 10 GB | ~0 % |
| D1 filas escritas | Reclamos y bajas: decenas/día | 100.000/día | ~0 % |
| KV | **0** | 1.000 escrituras/día | 0 % |
| Cron triggers | **0** (el lote corre fuera de Cloudflare) | 5 | 0 |
| Workers nuevos | **0** (se reutiliza `fize-astro`) | 100 | 0 |

Comparación: la carta pública **de hoy** (SSR + una lectura R2 por registro) gastaría ~55 lecturas R2 y 1
petición del Worker por visita; por eso la carta publicada como instantánea ([ALCANCE.md](ALCANCE.md) §4.4)
es requisito previo del directorio.

## 11. Criterios de aceptación

- [ ] Con la ubicación concedida, la lista de los 20 más cercanos aparece en < 2 s en 4G, sin invocar el Worker (verificable en las métricas del Worker: 0 peticiones por búsqueda).
- [ ] Sin conceder ubicación, se puede buscar eligiendo ciudad.
- [ ] Ninguna petición de red contiene latitud/longitud del visitante (prueba con el inspector de red).
- [ ] Un restaurante con "Ahora no" en el paso 6 no aparece en ningún archivo `dir/v1/**`.
- [ ] Ningún archivo del índice contiene `instance_id`, costos, recetas ni teléfonos de fichas OSM.
- [ ] Una baja desaparece de la búsqueda en ≤ 10 min y no vuelve tras el siguiente lote.
- [ ] La atribución de OpenStreetMap es visible en la página.
