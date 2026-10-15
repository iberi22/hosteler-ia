import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import type { DomainRecord } from '../../../lib/domain';
import { isOrderStatus } from '../../../lib/orderStateMachine';
import { resolvePublicTenant, resolveRequestTenant, authErrorResponse } from '../../../lib/auth/tenant';

const orderItemSchema = z.object({
  menuItemId: z.string().min(1, { message: 'menuItemId is required' }),
  qty: z.number().int().positive({ message: 'qty must be a positive integer' }),
  note: z.string().optional(),
});

const createOrderSchema = z.object({
  tableId: z.string().min(1, { message: 'tableId is required' }),
  items: z.array(orderItemSchema).min(1, { message: 'Order must have at least 1 item' }),
  note: z.string().optional(),
  instance_id: z.string().optional(),
});

// Random UUID: the id is the customer's capability to read the order status, so it must not be guessable.
function genId(): string {
  return crypto.randomUUID();
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const url = new URL(request.url);
    const instanceId = await resolveRequestTenant(locals, request);
    const statusFilter = url.searchParams.get('status');

    if (statusFilter && !isOrderStatus(statusFilter)) {
      return new Response(JSON.stringify({ error: `Invalid status filter: ${statusFilter}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const adapter = createStorageAdapter(locals);
    const list = await adapter.list('order', instanceId);
    const active = list.filter((item) => {
      const r = item as Record<string, unknown>;
      if (r.deleted_at) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });

    return new Response(JSON.stringify(active), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = createOrderSchema.safeParse(body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          details: z.treeifyError(validation.error),
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const data = validation.data;
    // Ruta de invitado (sin sesion): la instancia es la del despliegue. El `instance_id` del cliente
    // (query o body) se IGNORA por completo; no elige datos ni provoca 403.
    const instanceId = resolvePublicTenant(locals);

    const adapter = createStorageAdapter(locals);

    const table = await adapter.get('table', data.tableId, instanceId);
    if (!table || (table as Record<string, unknown>).deleted_at) {
      return new Response(JSON.stringify({ error: 'Table not found' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Hidratar nombre y precio desde el menuItem en el momento de crear el
    // pedido. Sin esto el KDS recibe items {menuItemId, qty} y no puede
    // pintar ni el nombre del plato ni el total: la cocina ve "$ 0".
    // El precio se congela aqui a proposito (el menu puede cambiar despues,
    // pero un pedido ya creado debe conservar lo que el cliente pidio y pago).
    const hydratedItems = [];
    for (const item of data.items) {
      const menuItem = await adapter.get('menuItem', item.menuItemId, instanceId);
      if (!menuItem || (menuItem as Record<string, unknown>).deleted_at) {
        return new Response(JSON.stringify({ error: `Menu item not found: ${item.menuItemId}` }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const m = menuItem as Record<string, unknown>;
      hydratedItems.push({
        menuItemId: item.menuItemId,
        name: String(m.name ?? ''),
        qty: item.qty,
        unitPrice: Number(m.price ?? 0),
      });
    }

    const now = new Date().toISOString();
    const newRecord: DomainRecord = {
      id: genId(),
      instance_id: instanceId,
      tableId: data.tableId,
      status: 'pending',
      items: hydratedItems,
      note: data.note ?? null,
      created_at: now,
      updated_at: now,
    } as DomainRecord;

    const created = await adapter.create('order', newRecord);

    return new Response(JSON.stringify(created), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
