// securityHeaders.ts — cabeceras de transporte/seguridad que comparten las DOS vias de respuesta.
//
// Fize responde por dos caminos y los dos tienen que llevar las mismas cabeceras:
//   1. Rutas SSR (/login, /dashboard/*, /api/*...) y sus 401/302: las pone src/middleware.ts en cada
//      respuesta, porque las respuestas del Worker NO pasan por `_headers`.
//   2. Estaticos y paginas prerenderizadas (/ , /offline, /local/*): no pasan por el Worker; las pone
//      public/_headers, que el build copia a dist/client/_headers. Ahora mismo hay una regla `/*` en ese
//      archivo con las tres (y `/local` + `/local/*` las repiten porque documentan el modo sin middleware).
//      scripts/gen-csp-headers.mjs aborta el build si `_headers` no las declara: una pagina sin HSTS no se
//      nota hasta que ya hay trafico en HTTP.
//
// El valor canonico vive aqui para que el test compare las dos copias: la de `_headers` es texto plano y no
// puede importar nada, asi que si se cambia aqui y no alli, el test lo dice.

/** HSTS: un ano, subdominios y preload. El navegador solo lo aplica sobre HTTPS (en HTTP lo ignora). */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains; preload';

export const X_CONTENT_TYPE_OPTIONS_VALUE = 'nosniff';

export const REFERRER_POLICY_VALUE = 'strict-origin-when-cross-origin';
