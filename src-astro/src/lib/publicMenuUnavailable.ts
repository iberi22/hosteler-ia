// publicMenuUnavailable.ts — la pantalla que ve el comensal cuando la carta todavia no esta
// publicada (o el enlace esta mal).
//
// QA pre-entrega 2026-10-13 #5: `/<slug>/menu` devolvia un 404 en crudo («No encontramos esa
// carta») mientras /local/publicar le prometia al duenno que el comensal veria «Esta carta
// todavía no está publicada». El estado sigue siendo 404 (el recurso no existe), pero el cuerpo
// es la pantalla amable que el duenno espera, con la salida para el duenno y para el comensal.

/** Escapa el slug antes de pintarlo: viene de la URL y no se confia en el. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const PUBLIC_MENU_UNPUBLISHED_TITLE = 'Esta carta todavía no está publicada';

/** Cuerpo HTML (sin layout) de la carta no publicada. `status` de la respuesta: 404. */
export function publicMenuUnavailableHtml(slug: string): string {
  const safeSlug = escapeHtml(slug);
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${PUBLIC_MENU_UNPUBLISHED_TITLE} — Fi'ze</title></head>` +
    '<body style="font-family:system-ui;background:#0a0a0a;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem;text-align:center">' +
    '<main style="max-width:28rem">' +
    `<h1 style="font-size:1.4rem;margin:0 0 .75rem">${PUBLIC_MENU_UNPUBLISHED_TITLE}</h1>` +
    '<p style="opacity:.75;line-height:1.5;margin:0 0 .75rem">Si eres el dueño: entra a tu panel de Fi\'ze y publica la carta desde <strong>Publicar</strong>. Hasta entonces nadie puede verla.</p>' +
    '<p style="opacity:.75;line-height:1.5;margin:0 0 1rem">Si ya la publicaste, revisa el enlace (para este local es <code>/' +
    safeSlug +
    '/menu</code>) o vuelve a escanear el código QR de la mesa.</p>' +
    '<p style="opacity:.55;font-size:.85rem;margin:0">La carta se publica desde este equipo, sin cuenta: se necesita conexión solo en ese momento.</p>' +
    '</main></body></html>'
  );
}
