// inlineScripts.ts — scripts que viajan INLINE dentro del HTML (`<script is:inline set:html={...}>`).
//
// Viven aqui, y no sueltos dentro del .astro, porque el CSP de Astro (`security.csp`) exige el hash
// SHA-256 de CADA script inline: `astro.config.mjs` importa estas constantes y calcula sus hashes en
// build. Una sola copia del texto = un solo hash que mantener (si el script se edita aqui, el hash
// del config se recalcula solo; si estuviera duplicado en el .astro, el hash dejaria de coincidir y
// el navegador bloquearia el script en silencio).
//
// El texto se inserta tal cual con `set:html`, asi que el hash del config es el de esta cadena exacta.

/** Aviso de "sin internet" del modo local (/local/*). No hace nada mas: el nodo sigue funcionando. */
export const NET_BANNER_SCRIPT = `(function () {
  var b = document.getElementById('net-banner');
  function paint() { if (b) b.hidden = navigator.onLine; }
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  paint();
})();`;

/** Pantalla /offline: avisa del estado de la red y reintenta sola cuando vuelve. */
export const OFFLINE_RETRY_SCRIPT = `(function () {
  var boton = document.getElementById('reintentar');
  var nota = document.getElementById('estado-red');
  var SIN_RED = 'Todavía sin red. Fi’ze reintentará solo en cuanto vuelvas.';

  function recargar() {
    window.location.reload();
  }

  function pintar() {
    if (nota) {
      nota.textContent = window.navigator.onLine
        ? 'Vuelve a haber red. Recuperando la pantalla…'
        : SIN_RED;
    }
  }

  if (boton) boton.addEventListener('click', recargar);

  pintar();

  // Al volver la red la recarga sola: el motivo de que esta pantalla exista
  // es que la navegacion fallo, y para entonces esa peticion ya tendra
  // respuesta. No se le pide al usuario que este pendiente.
  window.addEventListener('online', recargar);
})();`;

/**
 * /local/pedidos: marca el chip del filtro que corresponde a `?status=`.
 *
 * La pagina es prerenderizada, asi que `Astro.url.searchParams` es null en el
 * HTML generado y el chip activo quedaba siempre en «Todos» aunque el carril
 * filtrado fuese otro (QA pre-entrega 2026-10-13 #6). Aqui se lee la URL real,
 * en el cliente, que es donde existe.
 */
export const PEDIDOS_FILTER_SCRIPT = `(function () {
  var chips = document.querySelectorAll('[data-pedidos-chip]');
  if (!chips.length) return;
  var VALIDOS = ['pending', 'preparing', 'ready', 'served', 'paid', 'cancelled'];
  var status = '';
  try {
    status = new URLSearchParams(window.location.search).get('status') || '';
  } catch (err) {
    status = '';
  }
  if (VALIDOS.indexOf(status) === -1) status = '';
  for (var i = 0; i < chips.length; i++) {
    var chip = chips[i];
    var activo = chip.getAttribute('data-pedidos-chip') === status;
    chip.classList.toggle('active', activo);
    chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    if (activo) chip.setAttribute('aria-current', 'page');
    else chip.removeAttribute('aria-current');
  }
})();`;
