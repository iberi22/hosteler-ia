import { CLIENT_MENU_PATH } from '../config/client';

/**
 * Destino del CTA principal de la landing. El registro abierto (/register) esta
 * cerrado al publico (solo el primer usuario de una instancia es owner), asi que
 * "Registrar mi restaurante" lleva a un canal de contacto. Unico lugar donde se
 * define. Decision de Bel (2026-10-03): solo correo; hola@swal.network reenvia a su correo (Email Routing).
 */
export const CONTACT_URL =
  'mailto:hola@swal.network?subject=Quiero%20Fize%20para%20mi%20restaurante';

/** Correo visible en la landing (el mismo del CTA de contacto). */
export const CONTACT_EMAIL = 'hola@swal.network';

/** Empezar sin registro: nodo local en el navegador (docs/producto/NODO-LOCAL.md). */
export const START_URL = '/local/';

/** Carta real de ejemplo, ya publicada: la de la clienta de este despliegue (src/config/client.ts). */
export const DEMO_URL = CLIENT_MENU_PATH;
