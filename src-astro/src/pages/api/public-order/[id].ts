import type { APIRoute } from 'astro';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { publicOrderStatus } from '../../../lib/orderPublicStatus';

// Read-only, status-only view of one order for the customer waiting for it. The order id is
// the capability: new ids are random UUIDs (see api/orders genId), so they cannot be guessed.
const NO_STORE = { 'cache-control': 'no-store', 'content-type': 'application/json' };

export const GET: APIRoute = async ({ params, url, locals }) => {
  const id = params.id ?? '';
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: NO_STORE });
  }
  const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';
  const adapter = createStorageAdapter(locals);
  const order = (await adapter.get('order', id, instanceId)) as Record<string, unknown> | null;
  const body = publicOrderStatus(order);
  if (!body) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: NO_STORE });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: NO_STORE });
};
