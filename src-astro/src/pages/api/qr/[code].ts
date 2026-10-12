import type { APIRoute } from 'astro';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';

// PUBLIC endpoint (no auth) — exposes only client-safe fields:
// table number + capacity, restaurant public info, active menu items.
export const GET: APIRoute = async ({ params, request, locals }) => {
  try {
    const { code } = params;
    if (!code) {
      return new Response(JSON.stringify({ error: 'QR code required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const adapter = createStorageAdapter(locals);
    const tables = await adapter.list('table', instanceId);
    const table = tables.find(
      (t) => (t as Record<string, unknown>).qrCode === code && !(t as Record<string, unknown>).deleted_at,
    ) as Record<string, unknown> | undefined;

    if (!table) {
      return new Response(JSON.stringify({ error: 'QR code not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let restaurant: Record<string, unknown> | null = null;
    const restaurantId = table.restaurantId as string | null;
    if (restaurantId) {
      const rec = await adapter.get('restaurant', restaurantId, instanceId);
      if (rec && !(rec as Record<string, unknown>).deleted_at) {
        restaurant = {
          id: rec.id,
          name: (rec as Record<string, unknown>).name,
          slug: (rec as Record<string, unknown>).slug,
          address: (rec as Record<string, unknown>).address,
        };
      }
    }

    const menuItems = (await adapter.list('menuItem', instanceId))
      .filter((m) => !(m as Record<string, unknown>).deleted_at)
      .map((m) => {
        const r = m as Record<string, unknown>;
        return { id: r.id, name: r.name, price: r.price, categoryId: r.categoryId };
      });

    return new Response(
      JSON.stringify({
        table: { id: table.id, number: table.number, capacity: table.capacity },
        restaurant,
        menuItems,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
