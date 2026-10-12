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
