// domain.extensions.ts — entidades que pidio el cliente de Fi'ze.
//
// Este archivo agrupa lo que NO es el dominio base del restaurante (mesas,
// menu, pedidos) sino la capa de gestion: recetas, insumos, compras y
// facturacion. Se separa para que domain.config.ts siga siendo la lista
// corta que el nucleo entiende, y estas queden como extensiones explicitas.
//
// Regla de privacidad que atraviesa todo el archivo: una RECETA es propiedad
// intelectual del restaurante. Un plato puede ser publico en la carta y su
// receta privada al mismo tiempo. Por eso `Recipe.isPublic` NO existe: las
// recetas NUNCA se exponen, punto. Solo `menuItem.isPublic` decide si el plato
// aparece en la carta.
//
// Regla de dinero: los costos de receta se calculan a partir del costo real de
// los insumos (purchasePrice), no del precio de venta. Mezclarlos es el error
// clasico que hace que un restaurante piense que gana dinero en un plato.

// ---------------------------------------------------------------------------
// Proveedor: de quien se compra el insumo
// ---------------------------------------------------------------------------

export interface Supplier {
  id: string;
  instance_id: string;
  name: string;
  /** NIT / RFC / cedula. Opcional: muchos informales no lo tienen. */
  taxId?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Dias de credito acordados. 0 = contra entrega. */
  creditDays: number;
  isActive: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Compra: una factura de proveedor que entra al inventario
// ---------------------------------------------------------------------------

/** Estado del ciclo de una compra. `paid` y `received` son ejes separados. */
export type PurchaseStatus = 'draft' | 'received' | 'cancelled';

export interface PurchaseLine {
  inventoryItemId: string;
  name: string;
  qty: number;
  unit: string;
  /** Costo unitario pagado. Es el unico precio que alimenta el costo de receta. */
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  instance_id: string;
  supplierId: string;
  /** Numero de factura del proveedor. */
  invoiceNumber: string;
  /** Fecha de la factura tal como la emitio el proveedor (YYYY-MM-DD). */
  invoiceDate: string;
  status: PurchaseStatus;
  lines: PurchaseLine[];
  subtotal: number;
  tax: number;
  total: number;
  /** Foto o PDF de la factura. Opcional: no todos la escanean. */
  receiptUrl?: string;
  notes?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Receta: como se prepara un plato, y por cuanto
// ---------------------------------------------------------------------------

/** Ingredientes de una receta. `qty` en la unidad del insumo. */
export interface RecipeLine {
  inventoryItemId: string;
  name: string;
  qty: number;
  unit: string;
  /** Costo unitario congelado al momento de armar la receta. */
  unitCost: number;
  lineTotal: number;
}

export type RecipeVisibility = 'privada' | 'equipo';

export interface Recipe {
  id: string;
  instance_id: string;
  menuItemId: string;
  name: string;
  /** Raciones que salen de esta receta. Base de todos los tiempos y costos. */
  yield: number;
  lines: RecipeLine[];
  /** Costo total de los insumos para `yield` raciones. */
  costTotal: number;
  /** costTotal / yield. Es lo que cuesta UNA porcion. */
  costPerServing: number;
  /** Minutos de preparacion activa (no incluye el horno). */
  prepTimeMin: number;
  /** Minutos de coccion en horno/olla. 0 si no lleva. */
  cookTimeMin: number;
  /** Minutos totales = prep + cook. Derivado, se recalcula siempre. */
  totalTimeMin: number;
  /** Temperatura de coccion en grados Celsius. Opcional. */
  cookTempC?: number;
  /**
   * 'privada' = solo el dueno. 'equipo' = laCooking team la ve.
   * NUNCA 'publica': una receta nunca sale del panel. Lo que sale es el plato
   * (menuItem.isPublic), y solo su nombre/precio/foto.
   */
  visibility: RecipeVisibility;
  steps: string[];
  notes?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Derivados — funciones puras, testeables sin DB
// ---------------------------------------------------------------------------

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Total de dinero en pesos, sin decimales: el peso colombiano no usa centavos. */
export const roundCOP = (n: number) => Math.round(n);

/**
 * Costo de una porcion a partir de las lineas de receta.
 * Se ignora `lineTotal` de la linea y se recalcula desde qty * unitCost: si el
 * costo del insumo cambio, el costo real es el actual, no el guardado.
 */
export function costPerServing(lines: RecipeLine[], yieldQty: number): number {
  if (!Number.isFinite(yieldQty) || yieldQty <= 0) return 0;
  const total = lines.reduce((sum, l) => sum + roundCOP(l.qty * l.unitCost), 0);
  return round2(total / yieldQty);
}

/** Total de insumos de la receta (no dividido por yield). */
export function recipeCostTotal(lines: RecipeLine[]): number {
  return lines.reduce((sum, l) => sum + roundCOP(l.qty * l.unitCost), 0);
}

/** Tiempo total = preparacion + coccion. */
export function totalTime(prepTimeMin: number, cookTimeMin: number): number {
  return Math.max(0, Math.round(prepTimeMin)) + Math.max(0, Math.round(cookTimeMin));
}

/** Margen bruto de un plato: (precio - costo) / precio, en 0..1. */
export function grossMargin(price: number, cost: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return round2((price - cost) / price);
}

/**
 * True si NO conviene vender el plato: el costo iguala o supera el precio.
 * El margen negativo es la senal de que hay que subir precio o cambiar receta.
 */
export function isLossMaking(price: number, cost: number): boolean {
  return cost >= price && price > 0;
}

/** Total de una compra recalculado desde sus lineas. */
export function purchaseTotals(lines: PurchaseLine[], taxRate: number): {
  subtotal: number;
  tax: number;
  total: number;
} {
  const subtotal = lines.reduce((sum, l) => sum + roundCOP(l.qty * l.unitCost), 0);
  const tax = roundCOP(subtotal * (Number.isFinite(taxRate) ? taxRate : 0));
  return { subtotal, tax, total: subtotal + tax };
}

/**
 * Enlace de WhatsApp con el pedido listo para enviar.
 *
 * Se usa `wa.me` (click-to-chat) que no requiere API ni webhook: el mensaje se
 * abre en la app del cliente con el texto pre-cargado. Es la unica via que
 * funciona sin onboarding de la API de WhatsApp Business.
 *
 * Si el numero no es internacional se normaliza con el codigo de Colombia
 * (+57), que es donde esta el cliente.
 */
export function whatsappOrderLink(opts: {
  restaurantPhone: string;
  restaurantName: string;
  orderId: string;
  tableLabel: string;
  lines: Array<{ name: string; qty: number; unitPrice: number }>;
  total: number;
  /** URL publica del pedido, para que el cliente pueda revisarlo. */
  orderUrl?: string;
}): string {
  const phone = normalizeColombianPhone(opts.restaurantPhone);
  const body = buildWhatsappMessage(opts);
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

/** Normaliza a E.164 asumiendo Colombia cuando no trae codigo de pais. */
export function normalizeColombianPhone(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  // Ya trae codigo de pais (57...)
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  // Local con 0 inicial (0357...) -> se quita el 0
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  return `57${local}`;
}

/** Texto del mensaje, en el orden que lee un humano. */
export function buildWhatsappMessage(opts: {
  restaurantName: string;
  orderId: string;
  tableLabel: string;
  lines: Array<{ name: string; qty: number; unitPrice: number }>;
  total: number;
  orderUrl?: string;
}): string {
  const L = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
  const items = opts.lines.map((l) => `• ${l.qty} × ${l.name} — ${L(l.unitPrice * l.qty)}`).join('\n');
  const parts = [
    `Hola ${opts.restaurantName} 👋`,
    `Nuevo pedido en Fi'ze — mesa ${opts.tableLabel}`,
    '',
    items,
    '',
    `*Total: ${L(opts.total)}*`,
    `Pedido: ${opts.orderId}`,
  ];
  if (opts.orderUrl) parts.push(opts.orderUrl);
  return parts.join('\n');
}
