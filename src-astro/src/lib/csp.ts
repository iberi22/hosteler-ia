// csp.ts — CSP de respaldo del middleware.
//
// La politica buena (la que lleva los hashes SHA-256 de cada script y estilo inline) la genera Astro por
// pagina: `security.csp` en astro.config.mjs la emite como cabecera en las rutas SSR y como
// `<meta http-equiv>` en las prerenderizadas. Lo que queda fuera de ese camino es:
//   - el 404/500 que pinta el framework (HTML sin cabecera y sin hashes conocidos), y
//   - todo lo que no es HTML (JSON de la API, redirecciones).
// El middleware les pone estas dos politicas para que ninguna respuesta salga sin CSP. `script-src` se
// queda en `'self'`: ni `'unsafe-inline'` ni `'unsafe-eval'` ni en el respaldo.
//
// `style-src` si admite `'unsafe-inline'` en el respaldo: la pagina de error de Astro lleva su CSS inline
// (no hay forma de hashearlo desde el middleware) y sin el la pantalla saldria sin estilos. Es una pagina
// estatica sin datos del usuario, y solo aplica al camino de respaldo.

/** HTML que no pasa por `security.csp` (404/500 del framework). */
export const CSP_HTML_FALLBACK = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

/** Respuestas que no son HTML: no cargan subrecursos, asi que se cierra todo. */
export const CSP_NONE = ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"].join('; ');
