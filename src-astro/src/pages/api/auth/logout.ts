import type { APIRoute } from 'astro';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import { destroySession } from '../../../lib/auth/session';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance_id') ?? domainConfig.instanceId ?? 'default';

    const token = cookies.get('fize_session')?.value;
    if (token) {
      const adapter = createStorageAdapter(locals);
      await destroySession(adapter, instanceId, token);
    }

    cookies.delete('fize_session', { path: '/' });

    return new Response(JSON.stringify({ message: 'Signed out' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
