// Cloudflare inyecta en el borde su analitica (Web Analytics / RUM, `static.cloudflareinsights.com`) en
// el HTML de toda la zona swal.network. Fize promete "sin rastreo", asi que el HTML sale con
// `Cache-Control: no-transform`: con esa directiva Cloudflare no modifica la respuesta (medido 2026-10-02
// con un Worker de prueba: sin ella 1 beacon, con ella 0). Las paginas estaticas (landing, /offline)
// llevan la misma directiva en `public/_headers`, porque el middleware no corre sobre assets.
export function withNoTransform(cacheControl: string | null): string {
  const current = (cacheControl ?? '').trim();
  if (/(^|,)\s*no-transform\s*(,|$)/i.test(current)) return current;
  return current ? `${current}, no-transform` : 'no-transform';
}

export function isHtml(contentType: string | null): boolean {
  return (contentType ?? '').toLowerCase().includes('text/html');
}
