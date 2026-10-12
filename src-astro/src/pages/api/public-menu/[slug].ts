// POST /api/public-menu/<slug> — un nodo local publica su carta firmada (NODO-LOCAL.md §2.5).
// Es la UNICA ruta de /api/public-menu abierta sin sesion (middlewareGating.isPublicMenuPublishPath).
// La logica y las reglas estan en src/lib/publicMenuPublish.ts.
import type { APIRoute } from 'astro';
import { handlePublishRequest } from '../../../lib/publicMenuPublish';
import { getWorkerBindings, getWorkerCache } from '../../../lib/workerBindings';

export const prerender = false;

export const POST: APIRoute = async ({ request, params, url }) => {
  const env = await getWorkerBindings();
  return handlePublishRequest(request, params.slug, { env, origin: url.origin, cache: getWorkerCache() });
};
