import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listRestaurants, POST as createRestaurant } from '../pages/api/restaurants/index';
import { GET as getRestaurant, PATCH as updateRestaurant, DELETE as deleteRestaurant } from '../pages/api/restaurants/[id]';
import { getMemoryAdapter } from './domain';

describe('Restaurants API Endpoints', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const mockContext = (req: Request, params: Record<string, string> = {}) => ({
    request: req,
    params,
    locals: { user: mockUser },
  } as any);

  it('POST /api/restaurants - creates a new restaurant when payload is valid', async () => {
    const req = new Request('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'La Trattoria',
        slug: 'la-trattoria',
        address: 'Calle Mayor 12',
      }),
    });

    const res = await createRestaurant(mockContext(req));
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe('La Trattoria');
    expect(data.slug).toBe('la-trattoria');
    expect(data.address).toBe('Calle Mayor 12');
    expect(data.instance_id).toBe('default');
    expect(data.created_at).toBeDefined();
    expect(data.updated_at).toBeDefined();
  });

  it('POST /api/restaurants - fails validation when fields are missing', async () => {
    const req = new Request('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'La Trattoria',
        // missing slug and address
      }),
    });

    const res = await createRestaurant(mockContext(req));
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(data.details).toBeDefined();
  });

  it('GET /api/restaurants - lists active restaurants', async () => {
    const createReq = new Request('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bistro 21',
        slug: 'bistro-21',
        address: 'Av. Diagonal 400',
      }),
    });
    await createRestaurant(mockContext(createReq));

    const listReq = new Request('http://localhost/api/restaurants');
    const res = await listRestaurants(mockContext(listReq));
    expect(res.status).toBe(200);

    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Bistro 21');
  });

  it('GET /api/restaurants/[id] - retrieves restaurant by ID', async () => {
    const createReq = new Request('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tapas Bar',
        slug: 'tapas-bar',
        address: 'Plaza Real 5',
      }),
    });
    const createRes = await createRestaurant(mockContext(createReq));
    const created = await createRes.json();

    const getReq = new Request(`http://localhost/api/restaurants/${created.id}`);
    const res = await getRestaurant(mockContext(getReq, { id: created.id }));
    expect(res.status).toBe(200);

    const got = await res.json();
    expect(got.id).toBe(created.id);
    expect(got.name).toBe('Tapas Bar');
  });

  it('GET /api/restaurants/[id] - returns 404 if restaurant does not exist', async () => {
    const getReq = new Request('http://localhost/api/restaurants/non-existent-id');
    const res = await getRestaurant(mockContext(getReq, { id: 'non-existent-id' }));
    expect(res.status).toBe(404);
  });

  it('PATCH /api/restaurants/[id] - updates restaurant details', async () => {
    const createReq = new Request('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pizzeria',
        slug: 'pizzeria',
        address: 'Calle Roma 8',
      }),
    });
    const createRes = await createRestaurant(mockContext(createReq));
    const created = await createRes.json();

    const patchReq = new Request(`http://localhost/api/restaurants/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Pizzeria Napoli' }),
    });

    const res = await updateRestaurant(mockContext(patchReq, { id: created.id }));
    expect(res.status).toBe(200);

    const updated = await res.json();
    expect(updated.name).toBe('Pizzeria Napoli');
    expect(updated.slug).toBe('pizzeria');
  });

  it('DELETE /api/restaurants/[id] - soft deletes restaurant', async () => {
    const createReq = new Request('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sushi Zen',
        slug: 'sushi-zen',
        address: 'Gran Via 100',
      }),
    });
    const createRes = await createRestaurant(mockContext(createReq));
    const created = await createRes.json();

    const deleteReq = new Request(`http://localhost/api/restaurants/${created.id}`, {
      method: 'DELETE',
    });

    const delRes = await deleteRestaurant(mockContext(deleteReq, { id: created.id }));
    expect(delRes.status).toBe(200);

    // List should now be empty
    const listReq = new Request('http://localhost/api/restaurants');
    const listRes = await listRestaurants(mockContext(listReq));
    const list = await listRes.json();
    expect(list).toHaveLength(0);

    // GET by ID should return 404
    const getReq = new Request(`http://localhost/api/restaurants/${created.id}`);
    const getRes = await getRestaurant(mockContext(getReq, { id: created.id }));
    expect(getRes.status).toBe(404);
  });

  it('isolates restaurants by instance_id', async () => {
    const createReq1 = new Request('http://localhost/api/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resto A',
        slug: 'resto-a',
        address: 'Addr A',
        instance_id: 'inst-1',
      }),
    });
    await createRestaurant(mockContext(createReq1));

    const listReqInst1 = new Request('http://localhost/api/restaurants?instance_id=inst-1');
    const listResInst1 = await listRestaurants(mockContext(listReqInst1));
    const listInst1 = await listResInst1.json();
    expect(listInst1).toHaveLength(1);

    const listReqInst2 = new Request('http://localhost/api/restaurants?instance_id=inst-2');
    const listResInst2 = await listRestaurants(mockContext(listReqInst2));
    const listInst2 = await listResInst2.json();
    expect(listInst2).toHaveLength(0);
  });
});

describe('Restaurants API - WhatsApp (phone)', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const ctx = (req: Request, params: Record<string, string> = {}) =>
    ({ request: req, params, locals: { user: mockUser } } as any);
  const json = (method: string, url: string, body: unknown) =>
    new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('POST normaliza el WhatsApp a digitos con indicativo', async () => {
    const res = await createRestaurant(
      ctx(json('POST', 'http://localhost/api/restaurants', { name: 'Wa', slug: 'wa-uno', address: 'Calle 1', phone: '+57 300 123 4567' })),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).phone).toBe('573001234567');
  });

  it('POST rechaza un WhatsApp invalido con mensaje en español', async () => {
    const res = await createRestaurant(
      ctx(json('POST', 'http://localhost/api/restaurants', { name: 'Wa', slug: 'wa-dos', address: 'Calle 1', phone: '12345' })),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/WhatsApp/);
  });

  it('PATCH guarda el WhatsApp normalizado, lo valida y permite quitarlo', async () => {
    const created = await (
      await createRestaurant(ctx(json('POST', 'http://localhost/api/restaurants', { name: 'Wa', slug: 'wa-tres', address: 'Calle 1' })))
    ).json();
    const patch = (body: unknown) =>
      updateRestaurant(ctx(json('PATCH', `http://localhost/api/restaurants/${created.id}`, body), { id: created.id }));

    const ok = await patch({ phone: '3001234567' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).phone).toBe('573001234567');

    const bad = await patch({ phone: 'abc' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/WhatsApp/);

    const cleared = await patch({ phone: '' });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).phone).toBe('');
  });
});

describe('Restaurants API - slug', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const ctx = (req: Request, params: Record<string, string> = {}) =>
    ({ request: req, params, locals: { user: mockUser } } as any);
  const json = (method: string, url: string, body: unknown) =>
    new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const create = (slug: string, instance = '') =>
    createRestaurant(
      ctx(json('POST', `http://localhost/api/restaurants${instance}`, { name: 'R', slug, address: 'Calle 1' })),
    );

  it('POST rechaza formato, largo y reservados con 400 y mensaje en español', async () => {
    for (const slug of ['Mi Resto', 'ab', 'a'.repeat(61), '-x-', 'api', 'dashboard', 'order-confirmation', 'menu']) {
      const res = await create(slug);
      expect(res.status, slug).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
    }
  });

  it('POST responde 409 si el slug ya existe en la instancia', async () => {
    expect((await create('el-rincon')).status).toBe(201);
    const dup = await create('el-rincon');
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/ya está en uso/);
  });

  it('un restaurante borrado libera su slug', async () => {
    const first = await (await create('liberado')).json();
    await deleteRestaurant(
      ctx(json('DELETE', `http://localhost/api/restaurants/${first.id}`, {}), { id: first.id }),
    );
    expect((await create('liberado')).status).toBe(201);
  });

  it('PATCH valida el slug, devuelve 409 si es de otro y permite conservar el propio', async () => {
    const a = await (await create('resto-a1')).json();
    const b = await (await create('resto-b1')).json();
    const patch = (id: string, body: unknown) =>
      updateRestaurant(ctx(json('PATCH', `http://localhost/api/restaurants/${id}`, body), { id }));

    expect((await patch(b.id, { slug: 'resto-a1' })).status).toBe(409);
    expect((await patch(b.id, { slug: 'login' })).status).toBe(400);
    expect((await patch(b.id, { slug: 'Resto B' })).status).toBe(400);
    expect((await patch(b.id, { slug: 'resto-b1', name: 'B' })).status).toBe(200);
    const renamed = await patch(a.id, { slug: 'resto-a2' });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).slug).toBe('resto-a2');
  });
});
