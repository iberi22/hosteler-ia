// publicMenu.ts — carga la carta de una tienda por su slug.
//
// Regla de privacidad que separa esto de /api/recipes: aqui SOLO entran los
// platos marcados como publicos. Las recetas, sus insumos, tiempos y
// temperaturas no se consultan en esta ruta, ni por accidente. El unico filtro
// que decide que ve el cliente final es `isPublic` del plato.

export interface PublicMenuItem {
  id: string;
  name: string;
  price: number;
  description?: string;
  categoryId: string;
  isAvailable: boolean;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  description?: string;
}

export interface PublicMenuData {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    address?: string;
    phone?: string;
  };
  categories: PublicMenuCategory[];
  items: PublicMenuItem[];
}

interface Adapter {
  list(
    entity: string,
    instanceId: string,
  ): Promise<Array<Record<string, unknown>>>;
}

const truthy = (v: unknown) =>
  v === true || v === 1 || v === "true" || v === "1";

/**
 * Un plato es publico si `isPublic` no es false.
 *
 * Se opta por "publico por defecto" porque un restaurante carga su carta y
 * quiere que se vea; el que no quiere exponer un plato lo marca. Un default
 * contrario (oculto por defecto) dejaria las cartas vacias en cada alta y el
 * restaurante tendria que activar plato por plato.
 */
export function isPublicItem(item: Record<string, unknown>): boolean {
  return item.isPublic !== false;
}

// Palabras que describen produccion interna y no deben salir en la carta
// publica: la acuerdo es que recetas, insumos, costos y compras son privados.
// Una descripcion que las menciona se omite entera en vez de filtrarse a
// medias: media frase filtrada ("Bandeja paisa -") informa igual que la entera.
const INTERNAL_LEAK_REGEX = /\b(receta|inventario|costo|proveedor|compras)\b/i;

/**
 * Devuelve la descripcion apta para la vista publica, o undefined si no la hay.
 * No inventa texto ni recorta: o la descripcion es comercial o no se muestra.
 */
export function sanitizePublicDescription(desc: unknown): string | undefined {
  if (typeof desc !== "string") return undefined;
  const trimmed = desc.trim();
  if (!trimmed) return undefined;
  if (INTERNAL_LEAK_REGEX.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Quita platos repetidos de la carta.
 *
 * No basta con deduplicar por `id`: una corrida duplicada del seed crea filas
 * nuevas con ids distintos pero el MISMO nombre, precio y descripcion, asi que
 * el id no las detecta y el cliente ve cada plato dos veces. La identidad real
 * de un plato en la carta es restaurante + nombre + precio.
 *
 * Si el mismo nombre aparece con precios distintos, son platos de verdad
 * distintos (el restaurante los subio dos veces a precios diferentes) y se
 * respetan ambos: la deduplicacion no debe borrar oferta real.
 */
export function dedupeMenuItems(
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const key = [
      String(item.restaurantId ?? ""),
      String(item.name ?? "")
        .trim()
        .toLowerCase(),
      String(item.price ?? ""),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Indica si un restaurante tiene telefono configurado (string no vacio).
 */
function hasPhone(r: Record<string, unknown>): boolean {
  return typeof r.phone === "string" && r.phone.trim().length > 0;
}

/**
 * Desempate explicito cuando varios restaurantes comparten slug (o id):
 * 1. Prefiere el restaurante que tenga `phone` configurado para evitar dejar
 *    el CTA de WhatsApp mudo en la carta publica.
 * 2. Si ambos tienen o no tienen telefono, prefiere el mas antiguo por `created_at`.
 */
function pickBestRestaurant(
  candidates: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const sorted = [...candidates].sort((a, b) => {
    const aPhone = hasPhone(a) ? 1 : 0;
    const bPhone = hasPhone(b) ? 1 : 0;
    if (aPhone !== bPhone) {
      return bPhone - aPhone; // Gana el que tiene phone
    }

    const aTime = a.created_at ? new Date(String(a.created_at)).getTime() : NaN;
    const bTime = b.created_at ? new Date(String(b.created_at)).getTime() : NaN;
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
      return aTime - bTime; // Gana el mas antiguo (menor timestamp)
    }

    return 0;
  });

  return sorted[0];
}

/**
 * Resuelve la tienda por slug. El slug es la URL que el cliente ve
 * (fize.swal.network/{slug}/menu), por eso se compara sin distinguir mayusculas
 * y sin acentos: "Sabor-Paisa" y "sabor paisa" deben abrir la misma carta.
 *
 * Si existen registros duplicados con el mismo slug, aplica el desempate
 * explicito: da prioridad al que tenga telefono y al mas antiguo.
 */
export function findRestaurantBySlug(
  restaurants: Array<Record<string, unknown>>,
  slug: string,
): Record<string, unknown> | null {
  const want = normalizeSlug(slug);
  if (!want) return null;

  const slugMatches = restaurants.filter(
    (r) => normalizeSlug(String(r.slug ?? "")) === want,
  );
  if (slugMatches.length > 0) {
    return pickBestRestaurant(slugMatches);
  }

  // Fallback por id: los QR ya publicados usaban el id, no pueden romperse.
  const idMatches = restaurants.filter((r) => String(r.id) === slug);
  if (idMatches.length > 0) {
    return pickBestRestaurant(idMatches);
  }

  return null;
}

/** minusculas, sin acentos, con guiones y espacios normalizados. */
export function normalizeSlug(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loadMenuBySlug(
  adapter: Adapter,
  instanceId: string,
  slug: string,
): Promise<PublicMenuData | null> {
  const [restaurants, categories, items] = await Promise.all([
    adapter.list("restaurant", instanceId),
    adapter.list("category", instanceId),
    adapter.list("menuItem", instanceId),
  ]);

  const restaurant = findRestaurantBySlug(restaurants, slug);
  if (!restaurant) return null;

  const rid = String(restaurant.id);
  // La carta nunca debe mostrar el mismo plato dos veces: una corrida
  // duplicada del seed deja filas con ids distintos pero nombre y precio
  // iguales. Se deduplica por identidad de negocio antes de filtrar.
  const publicItems = dedupeMenuItems(items as Array<Record<string, unknown>>)
    .filter((i) => String(i.restaurantId ?? rid) === rid)
    .filter(isPublicItem)
    .filter((i) => i.isAvailable !== false)
    .map((i): PublicMenuItem => {
      const description = sanitizePublicDescription(i.description);
      return {
        id: String(i.id),
        name: String(i.name ?? ""),
        price: Number(i.price ?? 0),
        ...(description ? { description } : {}),
        categoryId: String(i.categoryId ?? ""),
        isAvailable: truthy(i.isAvailable) || i.isAvailable === undefined,
      };
    });

  const usedCategoryIds = new Set(publicItems.map((i) => i.categoryId));
  const publicCategories = (categories as Array<Record<string, unknown>>)
    .filter((c) => usedCategoryIds.has(String(c.id)))
    .map(
      (c): PublicMenuCategory => ({
        id: String(c.id),
        name: String(c.name ?? ""),
        ...(c.description ? { description: String(c.description) } : {}),
      }),
    );

  return {
    restaurant: {
      id: rid,
      name: String(restaurant.name ?? "Fi'ze"),
      slug: String(restaurant.slug ?? ""),
      ...(restaurant.address ? { address: String(restaurant.address) } : {}),
      ...(restaurant.phone ? { phone: String(restaurant.phone) } : {}),
    },
    categories: publicCategories,
    items: publicItems,
  };
}
