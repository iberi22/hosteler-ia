// tableQr.ts — que URL codifica el QR de una mesa.
//
// QA pre-entrega 2026-10-13 #4: en /local/mesas el QR resolvia a
// `http://localhost:PUERTO/table/<uuid>`, la direccion del equipo del duenno,
// que en el celular del comensal no abre nada. La unica URL que el comensal
// puede abrir es la carta publicada: `https://fize.swal.network/<slug>/menu?mesa=N`.
//
// Mientras la carta no este publicada no hay QR publico posible: se devuelve
// `null` y la pantalla manda a Publicar (no se inventa un enlace roto).
import { publicMenuUrl } from './localMode';

export interface TableQrInput {
  /** True en las pantallas `/local/*` (sin cuenta). */
  local: boolean;
  /** La mesa, tal como la devuelve `/api/tables`. */
  table: { number: number; qrCode?: string } | null;
  /** Slug del restaurante (modo local). */
  slug?: string;
  /** True si la carta ya se publico (`lastPublishedAt` + slug coincidente). */
  published?: boolean;
  /** Origen del equipo, para el QR del dashboard servido. */
  origin?: string;
}

/**
 * - Modo local publicado -> `https://fize.swal.network/<slug>/menu?mesa=N`
 * - Modo local sin publicar -> `null` (el QR aun no existe; se manda a Publicar)
 * - Dashboard servido -> `<origin>/table/<qrCode>` (lo de siempre)
 */
export function resolveTableQrUrl(input: TableQrInput): string | null {
  if (!input.table) return null;
  if (input.local) {
    if (!input.slug || !input.published) return null;
    return publicMenuUrl(input.slug, input.table.number);
  }
  if (!input.table.qrCode) return null;
  return input.origin ? `${input.origin}/table/${input.table.qrCode}` : `/table/${input.table.qrCode}`;
}
