import type { APIRoute } from 'astro';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { resolveSession } from '../../../lib/auth/session';

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const token = cookies.get('fize_session')?.value;
    const adapter = createStorageAdapter(locals);
    const session = await resolveSession(adapter, instanceId, token);

    if (!session) {
      return new Response(JSON.stringify({ user: null, profile: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const restaurants = await adapter.list('restaurant', instanceId);
    const first = restaurants.find((r) => !(r as Record<string, unknown>).deleted_at) as
      | Record<string, unknown>
      | undefined;

    return new Response(
      JSON.stringify({
        user: session.user,
        profile: {
          id: session.user.id,
          restaurant_id: first ? String(first.id) : null,
          role: session.user.role,
          restaurant: first ? { id: String(first.id), name: String(first.name ?? '') } : null,
        },
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
