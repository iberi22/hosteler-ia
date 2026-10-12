import type { APIRoute } from 'astro';
import { createStorageAdapter } from '../../lib/storageAdapter';
import { domainConfig } from '../../lib/domain.config';
import { loadMenuBySlug } from '../../lib/publicMenuBySlug';
import { loadPublicMenu } from '../../lib/publicMenu';
import { loadPublicNutrition } from '../../lib/publicMenuNutrition';

export const GET: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId;
  const slug = url.searchParams.get('slug');
  const restaurantId = url.searchParams.get('restaurantId');
  const adapter = createStorageAdapter(locals);
  try {
    const menu = slug ? await loadMenuBySlug(adapter, instanceId, slug)
      : restaurantId ? await loadPublicMenu(adapter, instanceId, restaurantId) : undefined;
    if (!menu?.restaurant) return Response.json({ error: 'Carta no encontrada' }, { status: 404 });
    const totals = await loadPublicNutrition(adapter, instanceId, menu.items.map(i => i.id));
    return Response.json(totals);
  } catch {
    // Optional enrichment: failures never prevent loading the menu or placing an order.
    return Response.json({}, { status: 503 });
  }
};
