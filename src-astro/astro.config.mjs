import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import cloudflare from "@astrojs/cloudflare";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { themeBootScript } from "@swal/ui/theme-boot";
import { NET_BANNER_SCRIPT, OFFLINE_RETRY_SCRIPT } from "./src/lib/inlineScripts";
import { existsSync } from "node:fs";
import { cloudAlias, CLOUD_DEDUPE, resolveCloud } from "./cloud.config.mjs";

// --- Modulo cloud (src/cloud) -------------------------------------------------------------------
// Facturacion, consumo, facturas y cobros solo entran al build si private/cloud existe (o FIZE_CLOUD=1).
// Sin el modulo, la app es local-first pura. Ver cloud.config.mjs.
const CLOUD = resolveCloud();
console.log(`[fize] modulo cloud: ${CLOUD.enabled ? "habilitado" : "deshabilitado (local-first)"}`);

// --- Wrangler ------------------------------------------------------------------------------------
// wrangler.jsonc NO se versiona: tiene los ids reales de la cuenta (D1, KV) y se copia en el deploy desde
// el repo privado de infraestructura (plantilla: wrangler.example.jsonc). Sin el, se usa wrangler.e2e.jsonc:
// solo bindings locales de miniflare (ids de relleno), suficiente para build, preview y la suite E2E.
// FIZE_WRANGLER_CONFIG lo fuerza (scripts/build-ci.mjs compila con el de E2E aunque exista el real).
const WRANGLER_CONFIG =
  process.env.FIZE_WRANGLER_CONFIG ||
  (existsSync(fileURLToPath(new URL("./wrangler.jsonc", import.meta.url))) ? "wrangler.jsonc" : "wrangler.e2e.jsonc");
console.log(`[fize] wrangler: ${WRANGLER_CONFIG}`);

// --- CSP (F12) ---------------------------------------------------------------------------------
//
// Astro calcula y emite el CSP por pagina (`security.csp`): cabecera `content-security-policy` en las
// rutas SSR y `<meta http-equiv="content-security-policy">` en las prerenderizadas, con el hash SHA-256
// de cada script/estilo inline que emite el propio framework (runtime de islas, chunks inlinados,
// estilos de pagina). Sin `'unsafe-inline'` en `script-src`: un XSS inyectado no ejecuta.
//
// Lo que Astro NO hashea son los scripts `is:inline` escritos a mano, asi que sus hashes se calculan
// aqui desde la MISMA constante que el .astro inserta (src/lib/inlineScripts.ts + theme-boot del core):
// una sola copia del texto, un solo hash. Si el script cambia, el hash se recalcula en el build.
//
// Las rutas prerenderizadas (/ , /offline, /local/*) no pasan por el Worker, asi que su cabecera la pone
// `scripts/gen-csp-headers.mjs`, que copia el <meta> de cada HTML a dist/client/_headers. El <meta> se
// queda tambien: es lo que protege esas paginas si el asset se sirve sin `_headers`.
const sha256 = (text) => `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  // connect-src: solo los origenes que el codigo llama de verdad (grep de fetch/WebSocket en src/).
  //   - 'self': toda la API propia (/api/*) y el service worker.
  //   - https://gos.swal.network: GOS (nutricion/alergenos) desde GosIngredientPicker y menuNutritionCache.
  //   - http://localhost:8006: Xavier, memoria agentica local (src/lib/xavier.ts). Va en http porque el
  //     nodo la sirve en loopback; mover esta llamada al Worker es un pendiente aparte (xavier.ts:43).
  //   - ws:/wss:: la senalizacion de la malla y-webrtc es una URL que el usuario configura al emparejar
  //     (localStorage swal.signaling, ws://192.168.x.y:4444 en LAN); no se puede enumerar en build.
  "connect-src 'self' https://gos.swal.network http://localhost:8006 http://127.0.0.1:8006 ws: wss:",
];

const CSP_SCRIPT_HASHES = [
  // Prepaint del tema (core @swal/ui), en BaseLayout y LocalLayout.
  sha256(themeBootScript()),
  // Aviso de red del modo local (LocalLayout) y reintento de la pantalla /offline.
  sha256(NET_BANNER_SCRIPT),
  sha256(OFFLINE_RETRY_SCRIPT),
];

// Modo local (docs/producto/NODO-LOCAL.md §2.2): los handlers de src/pages/api/* tambien corren en el
// navegador sobre IndexedDB. En el bundle del CLIENTE, src/lib/storageAdapter.ts se cambia por su version de
// navegador para no arrastrar @swal/vault (Buffer, node:crypto) ni el await de nivel superior que busca
// `cloudflare:workers`. El Worker (SSR/prerender) sigue usando el archivo de siempre.
const SERVER_STORAGE_ADAPTER = fileURLToPath(new URL("./src/lib/storageAdapter.ts", import.meta.url));
const BROWSER_STORAGE_ADAPTER = fileURLToPath(new URL("./src/lib/local/storageAdapter.browser.ts", import.meta.url));

function browserStorageAdapter() {
  return {
    name: "fize-browser-storage-adapter",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !/storageAdapter(\.ts)?$/.test(source)) return null;
      const isClient = this.environment ? this.environment.config.consumer === "client" : !options?.ssr;
      if (!isClient) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && resolved.id === SERVER_STORAGE_ADAPTER ? BROWSER_STORAGE_ADAPTER : null;
    },
  };
}

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare-binding",
    platformProxy: { enabled: true },
    configPath: WRANGLER_CONFIG,
  }),
  integrations: [svelte()],
  security: {
    csp: {
      algorithm: "SHA-256",
      directives: CSP_DIRECTIVES,
      scriptDirective: { hashes: CSP_SCRIPT_HASHES },
      styleDirective: {
        // Los atributos `style="..."` (el shell del core los usa) los gobierna `style-src-attr`, que
        // cae a `style-src` cuando no se declara: con hashes en `style-src` y sin `'unsafe-inline'`
        // quedarian bloqueados y el layout perderia su fondo. Se permite solo en el ambito attribute.
        resources: [{ resource: "'unsafe-inline'", kind: "attribute" }],
      },
    },
  },
  vite: {
    plugins: [
      browserStorageAdapter(),
      VitePWA({
        registerType: 'autoUpdate',
        includeManifestIcons: true,
        includeAssets: ['favicon.svg', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
        manifest: {
          name: "Fi'ze — Hosteler-IA",
          short_name: "Fi'ze",
          description: "Gestión hostelera integral: inventario, menús, pedidos y cocina en tiempo real.",
          start_url: "/",
          display: "standalone",
          // Paleta Bone (tema Bone Warm Minimalist del core @swal/ui). Antes
          // eran los colores de Edge-Hive —fondo #020617, barra #06b6d4 cyan—
          // que ya no existen en ningun token del tema, asi que la barra del
          // navegador y la pantalla de instalacion de la PWA se pintaban de un
          // color que la app no usa. BaseLayout.astro declara la variante
          // oscura/clara con <meta name="theme-color"> y media query.
          background_color: "#FAF9F5",
          theme_color: "#1C1917",
          orientation: "any",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
          runtimeCaching: [
            {
              // Pedidos offline: NetworkOnly + cola BackgroundSync fi-ze-orders
              urlPattern: /^https?:\/\/[^/]+\/api\/orders/i,
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
        },
      }),
    ],
    resolve: {
      alias: [
        { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
        cloudAlias(),
      ],
      dedupe: CLOUD_DEDUPE,
    },
    // Vite 8 (rolldown) re-hasheaba el chunk `handler` en cada ciclo de
    // re-optimizacion y el server pedia un hash ya borrado
    // ("The file does not exist at .../deps_ssr/handler-<hash>.js"), matando
    // `astro dev`. Fijar include hace el pre-bundle determinista.
    optimizeDeps: {
      include: [
        '@astrojs/svelte/server.js',
        'astro/runtime/server/index.js',
        'idb',
        'yjs',
        'y-indexeddb',
        'y-webrtc',
        'qrcode-generator',
        'zod',
      ],
    },
  },
});
