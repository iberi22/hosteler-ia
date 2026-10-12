import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getIdbAdapter, resetIdbForTests } from '../idbAdapter';
import { forceInstanceInBody, handleLocalRequest, localFetch } from './localApi';
import { deleteLocal } from './localDb';
import { ensureIdentity, resetIdentityCacheForTests } from './identity';

let LOCAL = 'local-test000000';
let seq = 0;

async function call(path: string, init: RequestInit = {}, instanceId = LOCAL) {
  const res = await handleLocalRequest(path, init, { instanceId });
  return { status: res.status, body: await res.json() };
}

function post(path: string, body: unknown, instanceId = LOCAL) {
  return call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, instanceId);
}

describe('localApi — mismos handlers de /api sobre IndexedDB', () => {
  beforeEach(async () => {
    // fake-indexeddb comparte la base entre casos: cada test usa su propia instancia local.
    LOCAL = `local-test${String(++seq).padStart(6, '0')}`;
    resetIdbForTests();
    await deleteLocal('identity');
    resetIdentityCacheForTests();
  });

  it('CRUD de categoría y plato con instance_id forzado a la instancia local', async () => {
    // El cliente intenta escribir en la instancia del demo: se ignora.
    const cat = await post('/api/categories?instance_id=default', { name: 'Almuerzos', instance_id: 'default' });
    expect(cat.status).toBe(201);
    expect(cat.body.instance_id).toBe(LOCAL);

    const dish = await post('/api/menu-items?instance_id=default', {
      name: 'Bandeja paisa',
      price: 28000,
      categoryId: cat.body.id,
      instance_id: 'default',
    });
    expect(dish.status).toBe(201);
    expect(dish.body.instance_id).toBe(LOCAL);

    const stored = await getIdbAdapter().list('menuItem', LOCAL);
    expect(stored.map((r) => (r as Record<string, unknown>).name)).toEqual(['Bandeja paisa']);
    expect(await getIdbAdapter().list('menuItem', 'default')).toHaveLength(0);

    const listed = await call('/api/menu-items?instance_id=default');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);

    const patched = await call(`/api/menu-items/${dish.body.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 30000, isAvailable: false }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.price).toBe(30000);
    expect(patched.body.isAvailable).toBe(false);

    const renamed = await call(`/api/categories/${cat.body.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Almuerzos del día' }),
    });
    expect(renamed.body.name).toBe('Almuerzos del día');

    const deleted = await call(`/api/menu-items/${dish.body.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect((await call('/api/menu-items')).body).toHaveLength(0);
  });

  it('otra instancia no ve ni modifica los datos locales', async () => {
    const cat = await post('/api/categories', { name: 'Bebidas' });
    const other = 'local-otro000000';
    expect((await call('/api/categories', {}, other)).body).toHaveLength(0);
    const res = await call(`/api/categories/${cat.body.id}`, { method: 'DELETE' }, other);
    expect(res.status).toBe(404);
  });

  it('restaurante: mismas validaciones que en la nube (WhatsApp y slug)', async () => {
    const bad = await post('/api/restaurants', { name: 'Doña Rosa', slug: 'api', address: 'Cra 1' });
    expect(bad.status).toBe(400);
    const badPhone = await post('/api/restaurants', { name: 'Doña Rosa', slug: 'dona-rosa', address: 'Cra 1', phone: '123' });
    expect(badPhone.status).toBe(400);

    const ok = await post('/api/restaurants', { name: 'Doña Rosa', slug: 'dona-rosa', address: 'Cra 1', phone: '300 123 4567' });
    expect(ok.status).toBe(201);
    expect(ok.body.phone).toBe('573001234567');
    expect(ok.body.instance_id).toBe(LOCAL);

    const me = await call('/api/auth/me');
    expect(me.body.user.role).toBe('owner');
    expect(me.body.profile.restaurant).toEqual({ id: ok.body.id, name: 'Doña Rosa' });
  });

  it('rutas sin implementar en local responden 501 y nunca van a la red', async () => {
    const res = await call('/api/orders');
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/modo local/);
  });

  it('localFetch sin identidad pide configurar el local; con identidad usa su instance_id', async () => {
    const before = await localFetch('/api/categories');
    expect(before.status).toBe(409);

    const identity = await ensureIdentity();
    const created = await localFetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Postres' }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).instance_id).toBe(identity.instanceId);
  });

  it('una BOM UTF-8 antes del JSON no evita forzar instance_id (auditoría S1, F-API-1)', async () => {
    const body = '\uFEFF' + JSON.stringify({ name: 'Intrusa', instance_id: 'local-victima00' });
    const res = await call('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(res.status).toBe(201);
    expect(res.body.instance_id).toBe(LOCAL);
    expect(await getIdbAdapter().list('category', 'local-victima00')).toHaveLength(0);

    // Igual si llega como Request (con su propio Content-Length).
    const req = new Request('http://fize.local/api/categories', { method: 'POST', body });
    const viaRequest = await handleLocalRequest(req, {}, { instanceId: LOCAL });
    expect(viaRequest.status).toBe(201);
    expect((await viaRequest.json()).instance_id).toBe(LOCAL);
    expect(await getIdbAdapter().list('category', 'local-victima00')).toHaveLength(0);
  });

  it('en escrituras solo se acepta un objeto JSON: arreglo, valor suelto o texto se rechazan (F-API-2)', async () => {
    for (const body of [
      JSON.stringify([{ name: 'Arreglo', instance_id: 'local-victima00' }]),
      '\uFEFF' + JSON.stringify([{ name: 'Arreglo', instance_id: 'local-victima00' }]),
      '"texto"',
      '42',
      'null',
      'no es json',
    ]) {
      const res = await call('/api/categories', { method: 'POST', body });
      expect(res.status, body).toBe(400);
    }
    expect(await getIdbAdapter().list('category', 'local-victima00')).toHaveLength(0);
    expect(await getIdbAdapter().list('category', LOCAL)).toHaveLength(0);
  });

  it('forceInstanceInBody siempre sobrescribe instance_id', () => {
    expect(JSON.parse(forceInstanceInBody('{"instance_id":"otra","a":1}', 'local-x') ?? '')).toEqual({ instance_id: 'local-x', a: 1 });
    expect(forceInstanceInBody('[]', 'local-x')).toBeNull();
  });
});
