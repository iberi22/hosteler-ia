// gen-sw.mjs — genera dist/client/sw.js con Workbox (BackgroundSync fi-ze-orders).
// Motivo: vite-plugin-pwa 1.3.0 + Vite 8 (rolldown) omite en silencio el bundle
// del SW en este proyecto (sí emite manifest + registerSW). Este paso post-build
// lo genera explícito con workbox-build. Verificar con: grep -c fi-ze-orders dist/client/sw.js
import { generateSW } from 'workbox-build';

const { count, size, warnings } = await generateSW({
  globDirectory: 'dist/client/',
  // webmanifest: el manifiesto de /local/ (y el raiz) tambien deben abrir sin red; sin el, la recarga offline
  // de /local/* dejaba un error de red en consola.
  globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,webmanifest}'],
  swDest: 'dist/client/sw.js',
  skipWaiting: true,
  clientsClaim: true,

  // El filtro `?status=` de las paginas de pedidos (/local/pedidos, /dashboard/orders) es un asunto del
  // cliente: el shell precacheado es el mismo con o sin el. Sin ignorarlo, la coincidencia con el precache
  // falla (`local/pedidos/index.html?status=paid` no existe) y la navegacion offline cae a /offline aunque la
  // pagina este precacheada: el E2E offline-local-first recarga `/local/pedidos/?status=paid` sin red y debe
  // ver el pedido cobrado, no "Sin conexion". `demo` es la bandera explicita de la demo del KDS
  // (`/local/cocina/?demo=1`, ver kdsAutoSeed.ts): el mismo shell, el mismo motivo.
  ignoreURLParametersMatching: [/^status$/, /^demo$/],

  // Navegaciones: RED PRIMERO y la pagina offline SOLO si la red falla.
  //
  // Antes se usaba `navigateFallback: '/offline/index.html'`. En Workbox eso NO es "cuando falla la red":
  // registra una NavigationRoute que sirve ese HTML para TODA navegacion no precacheada (patron app-shell
  // de SPA). Como la carta, el login y el panel son SSR, en cuanto el SW tomaba control (segunda visita)
  // todo comensal o dueno que volvia veia "Sin conexion" con la red funcionando. Medido en produccion
  // 2026-10-02: 1a visita a /restaurante-demo/menu = carta; 2a visita = "Sin conexion — Fi'ze".
  //
  // `/offline/index.html` sigue en el precache (globPatterns incluye html) para el `precacheFallback`.
  runtimeCaching: [
    {
      // Modo local (docs/producto/NODO-LOCAL.md §2.1): /local/ y /local/<pantalla>/ salen del PRECACHE (sus
      // index.html entran por globPatterns y la ruta de precache resuelve la barra final con directoryIndex),
      // asi que abren sin red desde la segunda visita. La forma SIN barra (/local/carta) no tiene variante en
      // el precache y caeria a NetworkFirst -> pagina offline; se redirige a la forma con barra, que es la
      // misma redireccion que hace el servidor de assets con red.
      urlPattern: ({ request, url }) => request.mode === 'navigate' && /^\/local(\/[a-z0-9-]+)?$/.test(url.pathname),
      handler: async ({ url }) => Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 302),
    },
    {
      // Panel: siempre red y sin guardar su HTML en el dispositivo (equipos compartidos en el local).
      urlPattern: ({ request, url }) => request.mode === 'navigate' && url.pathname.startsWith('/dashboard'),
      handler: 'NetworkOnly',
      options: { precacheFallback: { fallbackURL: '/offline/index.html' } },
    },
    {
      // Paginas publicas (carta, landing, login): red primero; sin red, la ultima copia o la pagina offline.
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'fize-pages',
        networkTimeoutSeconds: 4,
        cacheableResponse: { statuses: [200] },
        expiration: { maxEntries: 30 },
        precacheFallback: { fallbackURL: '/offline/index.html' },
      },
    },
    {
      // Pedidos offline: solo red + cola BackgroundSync con reintento automático
      urlPattern: /\/api\/orders/i,
      handler: 'NetworkOnly',
      method: 'POST',
      options: {
        backgroundSync: {
          name: 'fi-ze-orders',
          options: { maxRetentionTime: 24 * 60 },
        },
      },
    },
    {
      // Lecturas API: red primero, caché como respaldo
      urlPattern: /\/api\//i,
      handler: 'NetworkFirst',
      method: 'GET',
      options: {
        cacheName: 'fize-api',
        networkTimeoutSeconds: 3,
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-cache',
        expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'gstatic-fonts-cache',
        expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
});

if (warnings.length > 0) {
  for (const w of warnings) console.warn('[gen-sw]', w);
}
console.log(`[gen-sw] sw.js: ${count} precached, ${size} bytes`);
