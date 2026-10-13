// focusTrap.ts — foco de dialogos modales.
//
// El dialogo "Nuevo articulo" tenia `role="dialog" aria-modal="true"` pero sin
// trampa de foco: los 3 primeros Tab recorrian las tarjetas de atras y el foco
// entraba al dialogo en el 4.º (QA pre-entrega 2026-10-13 #14).
//
// Son dos funciones puras sobre el DOM, sin Svelte, para poder probarlas en
// jsdom sin montar un componente.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Elementos enfocables dentro de `root`, en orden de tabulacion. */
export function focusableWithin(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    // `closest` cubre un contenedor oculto, no solo el propio elemento. No se usa
    // `offsetParent`: jsdom no calcula layout y siempre devuelve null.
    if (el.closest('[hidden]')) return false;
    return true;
  });
}

/**
 * Lleva el foco al primer campo de formulario del contenedor (o al primer
 * enfocable si no hay campos). Devuelve si pudo enfocar algo.
 */
export function focusFirst(root: ParentNode, preferred = 'input, select, textarea'): boolean {
  const items = focusableWithin(root);
  const target = items.find((el) => el.matches(preferred)) ?? items[0];
  if (!target) return false;
  target.focus();
  return true;
}

/**
 * Cicla el foco dentro de `root` cuando se pulsa Tab. Se llama desde el
 * `keydown` del panel del dialogo; si el foco se escapo (o entra desde fuera),
 * lo devuelve al dialogo.
 */
export function trapTabKey(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = focusableWithin(root);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active =
    (event.target as HTMLElement | null) ??
    (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);

  if (!active || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
