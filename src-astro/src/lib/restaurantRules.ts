// restaurantRules.ts — reglas del perfil del restaurante compartidas por la API
// y el formulario de /dashboard/settings.
import { normalizeColombianPhone } from './domain.extensions';

/**
 * Valida el WhatsApp del local. Reutiliza `normalizeColombianPhone` (la misma
 * funcion con la que la carta publica arma el enlace wa.me), asi lo que se
 * guarda es exactamente lo que el enlace espera: digitos con indicativo, sin "+".
 *
 * Vacio es valido (campo opcional) y devuelve `phone: ''`.
 */
export function validateWhatsapp(raw: string): { ok: true; phone: string } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, phone: '' };
  const phone = normalizeColombianPhone(raw);
  // Colombia: indicativo 57 + 10 digitos (celular 3xx o fijo con prefijo).
  if (!/^57\d{10}$/.test(phone)) {
    return {
      ok: false,
      error: 'El WhatsApp debe tener 10 dígitos, por ejemplo 300 123 4567 o +57 300 123 4567.',
    };
  }
  return { ok: true, phone };
}

// ---------------------------------------------------------------------------
// Slug: es la URL publica (/{slug}/menu), asi que no puede chocar con una ruta
// de la app ni con un archivo estatico.
// ---------------------------------------------------------------------------

export const SLUG_MIN = 3;
export const SLUG_MAX = 60;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Rutas de primer nivel de `src/pages` (api, checkout, dashboard, login, menu,
 * offline, order-confirmation, pair, register, table) mas nombres que la
 * plataforma reserva para el futuro. Si se agrega una pagina de primer nivel,
 * agregala aqui tambien.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'dashboard',
  'login',
  'register',
  'registrar',
  'offline',
  'checkout',
  'table',
  'menu',
  'pair',
  'order-confirmation',
  'admin',
  'static',
  '_astro',
  'brand',
  'cerca',
  'directorio',
  'favicon',
  'manifest',
  'sw',
  // Modo local (NODO-LOCAL.md): `/local/*` es la app del nodo local.
  'local',
]);

/** Devuelve el motivo (en español) por el que el slug no sirve, o null si es valido. */
export function validateSlug(raw: string): string | null {
  const slug = raw.trim();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return `El slug debe tener entre ${SLUG_MIN} y ${SLUG_MAX} caracteres.`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'El slug solo puede tener minúsculas sin tildes, números y guiones (por ejemplo, el-sazon-de-la-abuela), sin guiones al inicio ni al final.';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return `"${slug}" es una palabra reservada de la plataforma. Elige otro slug.`;
  }
  return null;
}

/** Sugiere un slug desde el nombre: minúsculas, sin tildes, con guiones. */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

interface RestaurantLister {
  list(entity: string, instanceId: string): Promise<Array<Record<string, unknown>>>;
}

/** True si otro restaurante activo de la instancia ya usa ese slug. */
export async function isSlugTaken(
  adapter: RestaurantLister,
  instanceId: string,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const list = await adapter.list('restaurant', instanceId);
  return list.some(
    (r) => !r.deleted_at && r.id !== excludeId && String(r.slug ?? '').trim().toLowerCase() === slug.trim().toLowerCase(),
  );
}

export const SLUG_TAKEN_MESSAGE = 'Ese slug ya está en uso por otro restaurante. Elige uno distinto.';
