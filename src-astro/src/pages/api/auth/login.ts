import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createStorageAdapter } from '../../../lib/storageAdapter';
import { domainConfig } from '../../../lib/domain.config';
import {
  findUserByEmail,
  verifyPassword,
  createSession,
  isSecureRequest,
  getSessionCookieOptions,
} from '../../../lib/auth/session';
import {
  getRateLimitStoreAsync,
  consumeLoginAttempt,
  resetRateLimit,
} from '../../../lib/auth/rateLimit';

const loginSchema = z.object({
  email: z.email({ message: 'Valid email required' }),
  password: z.string().min(1, { message: 'Password required' }),
});

// Dummy hash used for non-existent users to equalize execution timing and prevent user enumeration
const DUMMY_HASH =
  '100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

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

    const validation = loginSchema.safeParse(body);
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

    const email = validation.data.email.trim().toLowerCase();
    const store = await getRateLimitStoreAsync(locals);

    // Slot de IP primero (CF-Connecting-IP, 30/min): un host que rota emails
    // golpea este bucket y NUNCA inserta la fila del email si ya esta lleno.
    const ip = request.headers.get('cf-connecting-ip')?.trim();
    if (ip) {
      const ipSlot = await consumeLoginAttempt(`ip:${ip}`, store, 30, 60);
      if (!ipSlot.allowed) {
        return new Response(
          JSON.stringify({ error: 'Too many failed login attempts. Please try again later.' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(ipSlot.retryAfterSeconds),
            },
          },
        );
      }
    }

    // El slot se toma ANTES de verificar la password: el consume es atomico en
    // D1, asi que N peticiones paralelas dejan exactamente N en el contador.
    const rateCheck = await consumeLoginAttempt(email, store);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ error: 'Too many failed login attempts. Please try again later.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rateCheck.retryAfterSeconds),
          },
        },
      );
    }

    // Siempre la instancia de ESTE despliegue: aceptar ?instance_id= dejaba crear el primer
    // dueno de cualquier instancia vacia que comparta D1/R2 con este Worker.
    const instanceId = domainConfig.instanceId ?? 'default';

    const adapter = createStorageAdapter(locals);
    const user = await findUserByEmail(adapter, instanceId, email);

    const hash = user ? String((user as Record<string, unknown>).passwordHash ?? '') : DUMMY_HASH;
    const ok = await verifyPassword(validation.data.password, hash);

    if (!user || !ok) {
      // El slot ya se tomo antes de verificar: 401 sin escribir otra vez.
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Login correcto: se libera el bucket del email (el de IP se deja: sigue
    // frenando fuerza bruta desde el mismo host). Si el borrado falla, el
    // login igualmente continua.
    await resetRateLimit(email, store).catch((err) => {
      console.error('[api/auth/login] rate-limit reset failed', err);
    });

    const token = await createSession(adapter, instanceId, user.id);
    const isSecure = isSecureRequest(request);
    cookies.set('fize_session', token, {
      ...getSessionCookieOptions(request),
      secure: isSecure, // Secure flag in production/HTTPS
    });

    const u = user as Record<string, unknown>;
    return new Response(JSON.stringify({ user: { id: u.id, email: u.email, name: u.name, role: u.role } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[api/auth/login:POST]', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
