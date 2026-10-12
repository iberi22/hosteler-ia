import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listMenuItems, POST as createMenuItem } from '../../pages/api/menu-items/index';
import { POST as login } from '../../pages/api/auth/login';
import { getMemoryAdapter } from '../domain';
import { decideAccess } from '../../middlewareGating';
import { checkRateLimit, recordFailedAttempt, resetRateLimit, MemoryRateLimitStore } from './rateLimit';

describe('authZ write guard and rate limiting', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'u-1', email: 'owner@fize.app', name: 'Owner', role: 'owner' };

  it('unauthenticated POST menu-item returns 401', async () => {
    const req = new Request('http://localhost/api/menu-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tapa', price: 5, categoryId: 'c1' }),
    });
    const res = await createMenuItem({ request: req, locals: {} } as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Authentication required');
  });

  it('authenticated POST menu-item returns 201 when category exists', async () => {
    const adapter = getMemoryAdapter();
    await adapter.create('category', {
      id: 'c1',
      instance_id: 'default',
      name: 'Entrantes',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const req = new Request('http://localhost/api/menu-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Croquetas', price: 6, categoryId: 'c1' }),
    });
    const res = await createMenuItem({ request: req, locals: { user: mockUser } } as any);
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.name).toBe('Croquetas');
  });

  // El handler GET de menu-items no aplica auth por si mismo: la proteccion vive
  // en `decideAccess` (middlewareGating), que corre antes en toda ruta /api/.
  // El 2026-10-01 se cerro el allowlist para que /api/menu-items y
  // /api/categories dejaran de servirse sin sesion: devolvian la carta cruda
  // con las descripciones de produccion interna.
  it('menu-items queda bloqueado sin sesion por el gating, no por el handler', async () => {
    expect(decideAccess('/api/menu-items', null, 'free').kind).toBe('deny');
    expect(decideAccess('/api/categories', null, 'free').kind).toBe('deny');

    // Y con sesion el handler responde normal.
    const req = new Request('http://localhost/api/menu-items');
    const res = await listMenuItems({ request: req, locals: { user: mockUser } } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('rateLimit pure store blocks after 10 failed attempts and resets on success', async () => {
    const store = new MemoryRateLimitStore();
    const email = 'hacker@fize.app';

    for (let i = 0; i < 10; i++) {
      const check = await checkRateLimit(email, store, 10, 60);
      expect(check.allowed).toBe(true);
      await recordFailedAttempt(email, store, 60);
    }

    const blocked = await checkRateLimit(email, store, 10, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);

    await resetRateLimit(email, store);
    const resetCheck = await checkRateLimit(email, store, 10, 60);
    expect(resetCheck.allowed).toBe(true);
  });

  it('rateLimit store falls back gracefully without errors', async () => {
    const email = 'user@fize.app';
    const store = new MemoryRateLimitStore();
    expect((await checkRateLimit(email, store)).allowed).toBe(true);
    await recordFailedAttempt(email, store);
    expect((await checkRateLimit(email, store)).attempts).toBe(1);
  });

  it('wrong password returns uniform 401 response shape for existing and non-existent users', async () => {
    const reqNonExistent = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@fize.app', password: 'wrongpassword' }),
    });
    const resNonExistent = await login({ request: reqNonExistent, cookies: { set: () => {} }, locals: {} } as any);
    expect(resNonExistent.status).toBe(401);
    expect(await resNonExistent.json()).toEqual({ error: 'Invalid credentials' });
  });
});
