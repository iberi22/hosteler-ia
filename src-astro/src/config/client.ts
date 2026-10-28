/**
 * Datos de la clienta de este despliegue. UNICO lugar donde viven: la landing (enlace "Ver la carta"),
 * la pantalla /offline, el seed (scripts/seed-demo.mjs) y la E2E de entrega (e2e/fize-client-delivery.spec.ts)
 * los leen de aqui. Para entregar a una clienta real se cambian estos tres valores y nada mas
 * (runbook de despliegue en el repo privado de infraestructura).
 *
 * Solo sintaxis TypeScript borrable (sin enums ni namespaces): Node lo importa directo desde los scripts .mjs.
 */
export interface ClientConfig {
  /** Nombre visible del restaurante. Del nombre sale el slug sugerido en el onboarding de /local/. */
  restaurantName: string;
  /** Enlace publico de la carta: fize.swal.network/<slug>/menu. Minusculas, numeros y guiones. */
  slug: string;
  /** WhatsApp que recibe los pedidos, en E.164 (+57 y 10 digitos). */
  whatsapp: string;
}

const getEnvName = () => {
  if (typeof process !== 'undefined' && process.env.PUBLIC_CLIENT_NAME) return process.env.PUBLIC_CLIENT_NAME;
  return import.meta.env?.PUBLIC_CLIENT_NAME;
};

const getEnvSlug = () => {
  if (typeof process !== 'undefined' && process.env.PUBLIC_CLIENT_SLUG) return process.env.PUBLIC_CLIENT_SLUG;
  return import.meta.env?.PUBLIC_CLIENT_SLUG;
};

const getEnvWhatsapp = () => {
  if (typeof process !== 'undefined' && process.env.PUBLIC_CLIENT_WHATSAPP) return process.env.PUBLIC_CLIENT_WHATSAPP;
  return import.meta.env?.PUBLIC_CLIENT_WHATSAPP;
};

const rawSlug = getEnvSlug() ?? 'restaurante-demo';
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
if (typeof rawSlug !== 'string' || rawSlug.length < 3 || rawSlug.length > 60 || !SLUG_PATTERN.test(rawSlug)) {
  throw new Error(`Invalid slug: ${rawSlug}`);
}

const rawWhatsapp = getEnvWhatsapp() ?? '+573005551234';
if (typeof rawWhatsapp !== 'string' || !/^\+\d+$/.test(rawWhatsapp)) {
  throw new Error(`Invalid whatsapp: ${rawWhatsapp}`);
}

export const CLIENT: ClientConfig = {
  restaurantName: getEnvName() ?? 'Restaurante Demo',
  slug: rawSlug,
  whatsapp: rawWhatsapp,
};

/** Ruta de la carta publica de la clienta. */
export const CLIENT_MENU_PATH = `/${CLIENT.slug}/menu`;

/** WhatsApp sin `+`, tal como va en `https://wa.me/<numero>`. */
export const CLIENT_WA_NUMBER = CLIENT.whatsapp.replace(/\D/g, '');
