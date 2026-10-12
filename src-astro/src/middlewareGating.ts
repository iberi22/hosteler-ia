import type { SessionUser } from './lib/auth/session';

export type AccessDecision =
  | { kind: 'allow'; user: SessionUser | null; tier: string }
  | { kind: 'redirect'; to: string }
  | { kind: 'deny'; status: number; error: string };

// Lo publico de verdad es la carta, que va por `/{slug}/menu` y se arma en
// `publicMenuBySlug.ts` (payload minimo: nombre, precio, descripcion limpia).
//
// `/api/menu-items` y `/api/categories` se sacaron de la allowlist el
// 2026-10-01: sin sesion devolvian la carta cruda, con las descripciones de
// produccion interna ("receta aplicada al inventario" x5) y con
// `instance_id` + timestamps que no necesita nadie fuera del tenant.
// `/api/menu-nutrition` (solo GET) alimenta la tarjeta nutricional de la carta publica: devuelve solo
// totales por porcion de los platos publicos (`publicMenuNutrition.ts`), nunca recetas ni inventario.
export const PUBLIC_PREFIXES = ['/api/qr/', '/api/auth/', '/api/restaurants', '/api/menu-nutrition'];
export const PUBLIC_PAGES = ['/', '/login', '/register'];
export const AI_PREFIX = '/api/ai/';
export const DASHBOARD_PREFIX = '/dashboard/';
export const API_PREFIX = '/api/';

export function isPublicPath(path: string): boolean {
  if (PUBLIC_PAGES.includes(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

/**
 * El cliente del restaurante NO esta logueado: entra por el QR de su mesa
 * (`/table/<qrCode>`), que es publico, y desde ahi manda su pedido.
 *
 * Con el deny-by-default de 2026-10-01 ese POST devolvia 401, y el fallo era
 * peor que un error visible: `CartSidebar.submit()` lo captura en el mismo
 * `catch` que usa para "sin conexion", encola el pedido en localStorage y le
 * dice al cliente "pedido guardado, se enviara solo". La cola no se reenvia
 * sola, asi que el pedido se perdia y el comensal creia que si.
 *
 * Se abre SOLO lo necesario y con el metodo acotado:
 *  - POST /api/orders            -> crear su pedido
 *
 * Lo que sigue privado: `GET /api/orders` (el listado con el dinero de todo el
 * local), PATCH/DELETE sobre pedidos, y cualquier otra ruta de /api/orders.
 */
export function isGuestOrderPath(path: string, method: string): boolean {
  if (method.toUpperCase() === 'POST') {
    // Solo la coleccion exacta: `/api/orders/<id>/transition` NO entra.
    return path === '/api/orders' || path === '/api/orders/';
  }
  return false;
}

/**
 * Un nodo local (sin cuenta) publica su carta firmada: `POST /api/public-menu/<slug>`.
 * La autorizacion es la firma de la llave del restaurante (y, la primera vez, el codigo de activacion
 * de SWAL), no la sesion; ver `lib/publicMenuPublish.ts`. Solo ese POST y solo un segmento de slug:
 * cualquier otro metodo o subruta de /api/public-menu sigue cerrado.
 */
export function isPublicMenuPublishPath(path: string, method: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  return /^\/api\/public-menu\/[^/]+\/?$/.test(path);
}

export function resolveTier(user: SessionUser | null, userRecord: Record<string, unknown> | null): string {
  if (!user) return 'free';
  const tier = userRecord ? String((userRecord as Record<string, unknown>).tier ?? 'free') : 'free';
  return tier === 'socio' || tier === 'socio-managed' ? tier : 'free';
}

// Núcleo puro y testeable: decide acceso según ruta + sesión + método.
//
// `method` solo importa para las rutas de invitado (`isGuestOrderPath`), que
// distinguen el POST que crea un pedido del GET que lista todos. Por defecto
// se trata como GET, que es lo que hacen los tests existentes.
export function decideAccess(
  path: string,
  user: SessionUser | null,
  tier: string,
  method = 'GET',
): AccessDecision {
  if (path.startsWith(AI_PREFIX)) {
    if (!user) return { kind: 'deny', status: 401, error: 'Authentication required' };
    if (tier === 'free') return { kind: 'deny', status: 402, error: 'Socio tier required for AI inference' };
    return { kind: 'allow', user, tier };
  }
  // `/dashboard` sin barra tambien es el panel: antes solo se protegia `/dashboard/...` y la portada del
  // panel (ventas, pedidos del dia, inventario bajo) se servia sin sesion.
  if (path === '/dashboard' || path.startsWith(DASHBOARD_PREFIX)) {
    if (!user) return { kind: 'redirect', to: '/login' };
    return { kind: 'allow', user, tier };
  }
  if (path.startsWith(API_PREFIX)) {
    // Deny-by-default para la API. Antes, cualquier ruta que no estuviera en las
    // listas de arriba caia en `allow`, y eso dejaba abiertos datos del negocio:
    // sin sesion, GET /api/inventory devolvia los costos de compra por kg,
    // /api/orders los pedidos con su dinero y /api/tables los QR de las mesas.
    // Rompia la promesa de "recetas privadas 100%": los ingredientes no estaban
    // en la receta, pero su costo si era publico via el inventario.
    // Lo publico de verdad es la carta (que va por /{slug}/menu, servida desde
    // publicMenuBySlug, no por estos endpoints) y el login.
    if (isPublicPath(path)) return { kind: 'allow', user, tier };
    if (!user && isGuestOrderPath(path, method)) {
      return { kind: 'allow', user: null, tier };
    }
    if (!user && isPublicMenuPublishPath(path, method)) {
      return { kind: 'allow', user: null, tier };
    }
    if (!user) return { kind: 'deny', status: 401, error: 'Authentication required' };
    return { kind: 'allow', user, tier };
  }
  return { kind: 'allow', user, tier };
}
