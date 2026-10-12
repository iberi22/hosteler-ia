# Fize — Landing

> Fecha: 2026-10-02. Parte de [ALCANCE.md](ALCANCE.md) (Fase 1, tarea 1.1).
> Hoy: `src-astro/src/pages/index.astro` + `src-astro/src/components/Landing.svelte` (titular "Sistema inteligente
> para hostelería", CTA principal "Acceso del personal" → `/login`). Renderizada en SSR: cada visita es una petición del Worker.

---

## 1. Base técnica

- **Construir sobre el PR #353** (`feat/redesign-visual`, abierto): rediseño de la landing, iconos SVG (`Icon.svelte` + `icons.ts`), nav móvil desplegable y el token **`--swal-on-accent`** que arregla el texto blanco sobre blanco de los botones `primary` en el tema Bone. Mergear #353 primero y partir de su `Landing.svelte`.
- Sistema de diseño **Bone** de `@swal/ui` (paquete de npm): `Button`, `Badge`, `Icon`, `Card`. Colores solo por tokens (`--swal-accent`, `--swal-on-accent`, `--swal-border`…); nada de `#fff` fijo.
- **Prerenderizar** la página: `export const prerender = true` en `index.astro` (como ya hace `src-astro/src/pages/offline.astro`). La landing pasa a ser un archivo estático: 0 peticiones al Worker por visita.
- Sin scripts de analítica ni píxeles de terceros. Islas Svelte solo donde haya interacción (FAQ con `<details>` no la necesita).
- Contraste WCAG 2.2 AA (≥ 4,5:1) en claro y oscuro; objetivos táctiles de 44 px.

## 2. Estructura

| # | Sección | Propósito | CTA |
|---|---------|-----------|-----|
| 0 | Barra superior | Marca y navegación | "Entrar" (secundario) |
| 1 | Hero | Qué es y la promesa | "Registrar mi restaurante" · "Ver menús cerca de mí" |
| 2 | Lo que ordena Fize | Beneficios para la cocina y la administración | — |
| 3 | Cómo empiezas | 3 pasos, < 10 minutos | "Registrar mi restaurante" |
| 4 | Pruébalo | Demo real | "Ver carta de ejemplo" |
| 5 | Para comensales | Menús cerca, alérgenos, pedir sin app | "Ver menús cerca de mí" |
| 6 | Tus datos son tuyos | Privacidad, con honestidad | "Leer la política de privacidad" |
| 7 | Precio | Gratis y cómo se sostiene | — |
| 8 | Preguntas frecuentes | Objeciones | — |
| 9 | Cierre | Último empujón | "Registrar mi restaurante" |
| 10 | Pie | Legales y atribuciones | — |

Mientras "Menús cerca de mí" no exista (Fase 2), su CTA lleva a la carta de ejemplo o se oculta. No enlazar a una página vacía.

## 3. Copy listo para pegar

### 0. Barra superior

`Fize` · Cómo funciona · Privacidad · Precio · Menús cerca · **Entrar**

### 1. Hero

> **Badge:** Gratis para restaurantes · Hecho en Colombia
>
> # Orden en tu cocina. Gratis. Tus datos son tuyos.
>
> Carta digital con QR, pedidos directo a cocina, recetas con costo por porción e inventario que se
> descuenta solo con cada venta. Para restaurantes, corrientazos, cafeterías y panaderías.
>
> **[Registrar mi restaurante]**  **[Ver menús cerca de mí]**
>
> Sin tarjeta · Sin publicidad · Listo en menos de 10 minutos

### 2. Lo que ordena Fize

> ## Todo lo de tu negocio en un solo lugar
>
> **Carta con QR y WhatsApp**
> Tus clientes ven la carta en el celular y piden desde la mesa o por WhatsApp. Cambias un precio y se
> actualiza al instante.
>
> **Pedidos a cocina**
> Cada pedido llega a la pantalla de cocina con su mesa y su estado. Nada de comandas perdidas.
>
> **Recetas y costos**
> Une cada plato con sus insumos y sabe cuánto te cuesta la porción y cuánto ganas.
>
> **Inventario que se descuenta solo**
> Cada plato vendido descuenta sus ingredientes. Fize te avisa antes de que algo se acabe.
>
> **Compras y proveedores**
> Registra facturas y proveedores; el inventario y el costo se actualizan con cada compra.
>
> **Sigue sin internet**
> Si se cae la conexión, la caja y la cocina siguen trabajando y todo se sincroniza al volver.

Iconos sugeridos (registro de `@swal/ui`): `qr`, `chef`, `package`, `wifi` (ya usados en la landing actual) y equivalentes para recetas y compras.

### 3. Cómo empiezas

> ## Empiezas en menos de 10 minutos
>
> 1. **Crea tu cuenta.** Solo nombre, correo y contraseña.
> 2. **Sube tu carta.** Empieza con una plantilla (corrientazo, comidas rápidas, cafetería…) y ajusta precios.
> 3. **Imprime tus QR y comparte tu enlace.** Tus clientes ya pueden pedir.
>
> **[Registrar mi restaurante]**

### 4. Pruébalo

> ## Mira una carta real
>
> Así ve tu cliente la carta en su celular: categorías, precios, información de alérgenos y botón para pedir.
>
> **[Ver carta de ejemplo]** → `https://fize.swal.network/restaurante-demo/menu`

Incluir una captura del celular con la carta de ejemplo (imagen local optimizada, con `alt` descriptivo).
La URL de ejemplo responde 200 (verificado 2026-10-02).

### 5. Para comensales

> ## ¿Buscas dónde comer?
>
> Encuentra cartas reales cerca de ti, filtra por tipo de comida, precio, horario o dieta, y oculta los
> platos con alérgenos que no puedes comer. Sin descargar nada y sin crear cuenta.
>
> Tu ubicación se usa solo en tu celular: no la guardamos ni la enviamos.
>
> **[Ver menús cerca de mí]**

### 6. Tus datos son tuyos

> ## Tus recetas y tus números son tuyos
>
> - **No vendemos ni usamos tus datos.** No los compartimos con nadie ni los usamos para publicidad.
> - **Cifrados desde el primer registro.** Cada receta, costo y venta se guarda cifrada.
> - **Sin rastreo.** Ni en tu panel ni en tu carta hay píxeles ni analítica de terceros.
> - **Puedes llevártelos.** Exporta toda tu información o borra tu cuenta cuando quieras.
> - **Tú decides qué es público.** Solo se publica lo que marcas: carta, precios, horario, ubicación.
>
> Somos transparentes: hoy SWAL custodia las llaves de cifrado para que Fize funcione en la nube. Estamos
> moviendo esas llaves a tus dispositivos; cuando terminemos, ni nosotros podremos leer tus recetas, costos ni ventas.
>
> **[Leer la política de privacidad]**

No usar "cifrado de extremo a extremo" ni "solo tú puedes leerlos" hasta cerrar la Fase 3 ([ALCANCE.md](ALCANCE.md) §5.2).
"Exporta o borra" requiere la tarea 1.7; si la landing sale antes, quitar esa viñeta.

### 7. Precio

> ## Gratis. De verdad.
>
> Carta, QR, pedidos, cocina, recetas, inventario y compras: gratis, sin límite de tiempo y sin tarjeta.
>
> **¿Cómo se sostiene?** Fize es parte de la red SWAL. Más adelante habrá servicios opcionales que sí nos
> cuestan dinero (por ejemplo respaldo gestionado o asistencia con inteligencia artificial). Lo que
> necesitas para trabajar cada día seguirá siendo gratis, y nunca vamos a vender tus datos para cubrir costos.

Ajustar el párrafo "¿Cómo se sostiene?" cuando Bel decida el modelo (ver [ALCANCE.md](ALCANCE.md) §5.3).

### 8. Preguntas frecuentes

> **¿De verdad es gratis? ¿Cuál es la trampa?**
> No hay trampa. Lo básico para trabajar es gratis para siempre. Si algún día ofrecemos algo de pago será
> opcional y por algo que nos cueste dinero, como respaldo gestionado o inteligencia artificial.
>
> **¿Qué hacen con mis datos?**
> Nada. No los vendemos, no los usamos para publicidad y no los compartimos. Se guardan cifrados y puedes
> exportarlos o borrarlos.
>
> **¿Ustedes pueden ver mis recetas o mis ventas?**
> Hoy la información se guarda cifrada, pero SWAL custodia las llaves para que la app funcione en la nube.
> No accedemos a ella salvo que nos lo pidas para darte soporte. Estamos moviendo las llaves a tus
> dispositivos para que ni siquiera eso sea posible.
>
> **¿Qué ve el público?**
> Solo lo que tú publicas: carta, precios, horario, ubicación y botón de WhatsApp. Recetas, costos,
> inventario y ventas nunca son públicos.
>
> **¿Necesito comprar equipos?**
> No. Funciona en el celular, una tableta o un computador que ya tengas. Para la cocina sirve cualquier tableta.
>
> **¿Y si se cae el internet?**
> Fize sigue funcionando en tus equipos y sincroniza cuando vuelve la conexión.
>
> **¿Cómo me pagan los clientes?**
> Como ya lo haces: efectivo, datafono, Bre-B o transferencia. Fize registra el cobro; no maneja tu dinero ni cobra comisiones.
>
> **¿Fize hace facturación electrónica?**
> Todavía no. Sigue usando tu proveedor de facturación; estamos evaluando integrarnos.
>
> **Mi negocio aparece en Fize y no lo registré.**
> Mostramos datos públicos de OpenStreetMap (nombre, tipo y ubicación). Puedes reclamar la ficha gratis o
> pedir que la quitemos con un clic.

La última pregunta solo se publica cuando exista la capa OSM del directorio (Fase 2).

### 9. Cierre

> ## Pon orden en tu cocina hoy
>
> Gratis, sin tarjeta y en menos de 10 minutos.
>
> **[Registrar mi restaurante]**  ¿Ya tienes cuenta? **Entrar**

### 10. Pie

> Fize es parte de SWAL · Términos · Política de privacidad · Contacto
> Datos de negocios © colaboradores de OpenStreetMap (ODbL) · Información nutricional: GOS

## 4. CTA y destinos

| CTA | Destino | Estado del destino |
|-----|---------|--------------------|
| Registrar mi restaurante | `/registrar` (asistente, [ONBOARDING.md](ONBOARDING.md)) | Falta; hasta Fase 1 usar `/register` |
| Ver menús cerca de mí | `/cerca` ([DIRECTORIO.md](DIRECTORIO.md)) | Falta (Fase 2) |
| Ver carta de ejemplo | `/restaurante-demo/menu` | Existe |
| Entrar | `/login` | Existe |
| Política de privacidad / Términos | `/privacidad`, `/terminos` | Faltan (tarea 1.8, abogado) |

## 5. SEO básico

| Elemento | Valor |
|----------|-------|
| `<html lang>` | `es-CO` |
| `<title>` | `Fize — Orden en tu cocina, gratis` |
| `meta description` | `Carta digital con QR, pedidos a cocina, recetas con costo e inventario automático para restaurantes en Colombia. Gratis y sin vender tus datos.` (≤ 160 caracteres) |
| Canonical | `https://fize.swal.network/` |
| Open Graph / Twitter | `og:title`, `og:description`, `og:image` 1200×630 (estática en `public/`), `og:locale=es_CO` |
| JSON-LD | `SoftwareApplication` (`applicationCategory: BusinessApplication`, `offers.price: 0`, `priceCurrency: COP`) + `Organization` (SWAL) |
| `sitemap.xml` | Landing, `/cerca`, legales y las cartas **publicadas** (`/{slug}/menu`) |
| Cartas públicas | Cada `/{slug}/menu` con `title` "Carta de {nombre} — Fize" y JSON-LD `Restaurant` + `Menu` (solo campos publicados) |
| `robots.txt` | Permitir landing y cartas; bloquear `/dashboard`, `/api`, `/table/`, `/checkout`, `/order-confirmation` |
| Rendimiento | LCP < 2,5 s, CLS < 0,05 (REQ-102 en `docs/SRS/REQUIREMENTS.md`); imágenes AVIF/WebP con tamaño declarado; fuentes del core sin bloquear |

## 6. Criterios de aceptación

- [ ] `index.astro` prerenderizada: el build genera `dist/client/index.html` y una visita no aparece en las métricas del Worker.
- [ ] Ningún botón con fondo sólido usa color de texto fijo; contraste ≥ 4,5:1 en tema claro y oscuro.
- [ ] Ningún texto dice "extremo a extremo", "conocimiento cero" ni "solo tú puedes leerlos".
- [ ] Todos los CTA llevan a páginas que existen (sin 404).
- [ ] 0 peticiones a dominios de terceros al cargar la landing (inspector de red).
- [ ] Lighthouse móvil: Rendimiento ≥ 90, Accesibilidad ≥ 95, SEO ≥ 95.
- [ ] `Landing.test.ts` actualizado al nuevo copy.
