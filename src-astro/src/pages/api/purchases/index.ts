import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { requireSession } from '../../../lib/auth/session';
import { resolveRequestTenant, authErrorResponse } from '../../../lib/auth/tenant';
import { purchaseTotals, roundCOP, type PurchaseLine } from '../../../lib/domain.extensions';
import type { DomainRecord, StorageAdapter } from '../../../lib/domain';
import { appendTx } from '../../../lib/inventoryLedger';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const lineSchema = z.object({
  inventoryItemId: z.string().min(1, 'Cada linea necesita el insumo'),
  name: z.string().min(1, 'Cada linea necesita el nombre del insumo'),
  qty: z.coerce.number().positive('La cantidad debe ser mayor que cero'),
  unit: z.string().min(1, 'Cada linea necesita la unidad'),
  unitCost: z.coerce.number().min(0, 'El costo no puede ser negativo'),
});

const createSchema = z.object({
  supplierId: z.string().min(1, 'Elige el proveedor'),
  invoiceNumber: z.string().min(1, 'El numero de factura es obligatorio'),
  invoiceDate: z.string().min(4, 'La fecha de la factura es obligatoria'),
  taxRate: z.coerce.number().min(0).max(1).default(0.19),
  receiptUrl: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, 'Una compra necesita al menos un insumo'),
});

/**
 * GET /api/purchases
 *
 * Devuelve las compras con el detalle de proveedor resuelto, porque el panel
 * muestra "Carniceria del Sur" y no un id opaco.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    requireSession(locals);
    // El tenant sale de la sesion; `?instance_id=` de otra instancia es 403 (ver lib/auth/tenant.ts).
    const instanceId = await resolveRequestTenant(locals, request);
    const adapter = createStorageAdapter(locals);
    const [purchases, suppliers] = await Promise.all([
      adapter.list('purchase', instanceId),
      adapter.list('supplier', instanceId),
    ]);
    const byId = new Map(suppliers.map((s) => [s.id, s as Record<string, unknown>]));
    const rows = (purchases as Array<Record<string, unknown>>)
      .map((p): Record<string, unknown> => ({
        ...p,
        supplierName: String(byId.get(String(p.supplierId))?.name ?? 'Proveedor eliminado'),
      }))
      .sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)));
    return json(rows, 200);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return json({ error: 'Internal Server Error' }, 500);
  }
};

/** Clave natural de una factura: misma instancia, proveedor, numero (sin mayusculas ni espacios) y fecha. */
function invoiceKey(instanceId: string, supplierId: string, invoiceNumber: string, invoiceDate: string): string {
  return [instanceId, supplierId, invoiceNumber.trim().toLowerCase().replace(/\s+/g, ' '), invoiceDate.trim()].join('|');
}

/** Id estable de la compra: la misma factura reenviada (doble clic, reintento sin red) da el mismo id. */
async function purchaseIdFor(key: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return `pur-${Array.from(hash.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function sameLines(a: unknown, b: PurchaseLine[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return b.every((l, i) => {
    const o = a[i] as Record<string, unknown> | null;
    return !!o && o.inventoryItemId === l.inventoryItemId && Number(o.qty) === l.qty && Number(o.unitCost) === l.unitCost;
  });
}

/** La compra ya registrada para esta factura (id estable o, si es anterior al arreglo, por sus campos). */
async function findExisting(
  adapter: StorageAdapter,
  instanceId: string,
  id: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  const byId = (await adapter.get('purchase', id, instanceId)) as Record<string, unknown> | null;
  if (byId) return byId;
  const all = (await adapter.list('purchase', instanceId)) as Array<Record<string, unknown>>;
  return (
    all.find(
      (p) => invoiceKey(instanceId, String(p.supplierId ?? ''), String(p.invoiceNumber ?? ''), String(p.invoiceDate ?? '')) === key,
    ) ?? null
  );
}

/**
 * Entra cada linea al libro de inventario (mismo `appendTx` que ventas y ajustes), una sola vez por linea:
 * el movimiento tiene id fijo `itx-<compra>-<linea>` y, para compras viejas, se reconoce por `reference`.
 */
async function applyLines(
  adapter: StorageAdapter,
  instanceId: string,
  purchaseId: string,
  lines: PurchaseLine[],
): Promise<Array<{ inventoryItemId: string; newStock: number; unitCost: number }>> {
  const previous = ((await adapter.list('inventoryTx', instanceId)) as Array<Record<string, unknown>>).filter(
    (t) => t.reference === purchaseId,
  );
  const applied: Array<{ inventoryItemId: string; newStock: number; unitCost: number }> = [];
  for (const [i, l] of lines.entries()) {
    const already = previous.some((t) => t.line === i || (t.line === undefined && t.inventoryId === l.inventoryItemId));
    if (!already) {
      await appendTx(adapter, instanceId, l.inventoryItemId, 'purchase', l.qty, `compra ${purchaseId}`, {
        id: `itx-${purchaseId}-${i}`,
        reference: purchaseId,
        line: i,
        unitCost: l.unitCost,
      });
    }
    // El costo unitario de la ultima compra alimenta el costo de las recetas.
    const item = (await adapter.update('inventoryItem', l.inventoryItemId, { unitCost: l.unitCost }, instanceId)) as
      | Record<string, unknown>
      | null;
    applied.push({ inventoryItemId: l.inventoryItemId, newStock: Number(item?.stock ?? 0), unitCost: l.unitCost });
  }
  return applied;
}

/**
 * POST /api/purchases — registra una factura de proveedor.
 *
 * Dos efectos, ambos intencionales:
 *  1. Guarda la compra como registro de lo que se compro y a quien.
 *  2. Entra el stock por el LIBRO de inventario (`appendTx` 'purchase', igual que ventas y ajustes) y
 *     actualiza el costo unitario, que alimenta el costo de las recetas. Antes el stock se sumaba por fuera
 *     del libro y la siguiente venta o ajuste (que recalcula stock = SUM(movimientos)) lo borraba.
 *
 * Idempotente: la misma factura (proveedor + numero + fecha) con las mismas lineas devuelve la compra ya
 * registrada (200) sin volver a sumar; con otras lineas es un conflicto (409). Si un intento anterior se
 * corto a mitad, el reintento solo aplica las lineas que faltaban.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSession(locals);
    // Query o body con otra instancia -> 403 antes de leer el cuerpo.
    const instanceId = await resolveRequestTenant(locals, request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) }, 422);
    }

    const adapter = createStorageAdapter(locals);

    const supplier = await adapter.get('supplier', parsed.data.supplierId, instanceId);
    if (!supplier) return json({ error: 'Proveedor no encontrado' }, 404);

    // Todas las lineas deben apuntar a insumos vivos: nada de factura con stock a medias.
    for (const l of parsed.data.lines) {
      const item = (await adapter.get('inventoryItem', l.inventoryItemId, instanceId)) as Record<string, unknown> | null;
      if (!item || item.deleted_at) return json({ error: `Insumo no encontrado: ${l.name}` }, 404);
    }

    const lines: PurchaseLine[] = parsed.data.lines.map((l) => ({
      ...l,
      lineTotal: roundCOP(l.qty * l.unitCost),
    }));

    const key = invoiceKey(instanceId, parsed.data.supplierId, parsed.data.invoiceNumber, parsed.data.invoiceDate);
    const id = await purchaseIdFor(key);
    const existing = await findExisting(adapter, instanceId, id, key);
    if (existing) {
      if (!sameLines(existing.lines, lines)) {
        return json({ error: 'Esa factura ya está registrada para este proveedor con otros insumos o cantidades.' }, 409);
      }
      const stockApplied = await applyLines(adapter, instanceId, String(existing.id), lines);
      return json({ purchase: existing, stockApplied, duplicate: true }, 200);
    }

    const { subtotal, tax, total } = purchaseTotals(lines, parsed.data.taxRate);
    const now = new Date().toISOString();

    const record: DomainRecord = {
      id,
      instance_id: instanceId,
      supplierId: parsed.data.supplierId,
      invoiceNumber: parsed.data.invoiceNumber,
      invoiceDate: parsed.data.invoiceDate,
      status: 'received',
      lines,
      subtotal,
      tax,
      total,
      ...(parsed.data.receiptUrl ? { receiptUrl: parsed.data.receiptUrl } : {}),
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      // `created_at` es la columna NOT NULL de sealed_meta. Con `createdAt` el
      // INSERT falla, la compra se queda en la memoria del isolate y GET devuelve
      // [] — el mismo fallo que aparecio ya en pagos y en recetas.
      created_at: now,
      updated_at: now,
    } as unknown as DomainRecord;

    // Se comprueba el resultado: un INSERT fallido devolvia 200 y el stock
    // avanzaba igual, así que el restaurante veía entradas de almacén sin
    // factura detrás.
    const persisted = await adapter.create('purchase', record);
    if (!persisted) {
      return json({ error: 'No se pudo guardar la compra' }, 500);
    }

    const stockApplied = await applyLines(adapter, instanceId, id, lines);
    return json({ purchase: record, stockApplied }, 201);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return json({ error: 'Internal Server Error' }, 500);
  }
};
