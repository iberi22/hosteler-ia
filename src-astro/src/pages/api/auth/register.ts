import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import {
  findUserByEmail,
  createUser,
  createSession,
  resolveSession,
  isSecureRequest,
  getSessionCookieOptions,
} from '../../../lib/auth/session';

const registerSchema = z.object({
  email: z.email({ message: 'Valid email required' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
  name: z.string().min(1, { message: 'Name is required' }),
});

export const POST: APIRoute = async ({ request, cookies, locals }) => {
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

    const validation = registerSchema.safeParse(body);
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

    // Siempre la instancia de ESTE despliegue: aceptar ?instance_id= dejaba crear el primer
    // dueno de cualquier instancia vacia que comparta D1/R2 con este Worker.
    const instanceId = domainConfig.instanceId ?? 'default';

    const adapter = createStorageAdapter(locals);
    const existing = await findUserByEmail(adapter, instanceId, validation.data.email);

    if (existing) {
      return new Response(JSON.stringify({ error: 'Email already registered' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Registro cerrado salvo dos casos. Antes cualquiera podia registrarse y entraba como `staff` del
    // restaurante (no hay control por rol: staff ve pedidos, dinero e inventario).
    //  1. La instancia no tiene usuarios: el primero es el dueno (alta inicial).
    //  2. Lo pide un dueno con sesion: da de alta a su personal (sin cambiar su propia sesion).
    const users = await adapter.list('user', instanceId);
    const activeUsers = users.filter((u) => !(u as Record<string, unknown>).deleted_at);
    const bootstrap = activeUsers.length === 0;
    const inviter = bootstrap ? null : await resolveSession(adapter, instanceId, cookies.get('fize_session')?.value);
    if (!bootstrap && inviter?.user.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Registration closed: ask the restaurant owner for access' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const user = await createUser(adapter, instanceId, {
      email: validation.data.email,
      name: validation.data.name,
      password: validation.data.password,
      role: bootstrap ? 'owner' : 'staff',
    });

    if (bootstrap) {
      const token = await createSession(adapter, instanceId, user.id);
      cookies.set('fize_session', token, {
        ...getSessionCookieOptions(request),
        secure: isSecureRequest(request), // Secure flag in production/HTTPS
      });
    }

    const u = user as Record<string, unknown>;
    return new Response(JSON.stringify({ user: { id: u.id, email: u.email, name: u.name, role: u.role } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
