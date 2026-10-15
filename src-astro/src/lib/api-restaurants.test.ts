import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listRestaurants, POST as createRestaurant } from '../pages/api/restaurants/index';
import { GET as getRestaurant, PATCH as updateRestaurant, DELETE as deleteRestaurant } from '../pages/api/restaurants/[id]';
import { getMemoryAdapter } from './domain';
import type { SessionUser } from './auth/session';
import { apiContext } from './testing/apiContext';

const mockUser: SessionUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };

const ctx = (req: Request, params: Record<string, string> = {}) =>
  apiContext({ request: req, params, user: mockUser });

const json = (method: string, url: string, body: unknown) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const asRecord = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;

describe('Restaurants API Endpoints', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  it('POST /api/restaurants - creates a new restaurant when payload is valid', async () => {
    const req = json('POST', 'http://localhost/api/restaurants', {
      name: 'La Trattoria',
      slug: 'la-trattoria',
      address: 'Calle Mayor 12',
    });

    const res = await createRestaurant(ctx(req));
    expect(res.status).toBe(201);

    const data = await asRecord(res);
    expect(data.id).toBeDefined();
    expect(data.name).toBe('La Trattoria');
    expect(data.slug).toBe('la-trattoria');
    expect(data.address).toBe('Calle Mayor 12');
    expect(data.instance_id).toBe('default');
    expect(data.created_at).toBeDefined();
    expect(data.updated_at).toBeDefined();
  });

  it('POST /api/restaurants - fails validation when fields are missing', async () => {
    const req = json('POST', 'http://localhost/api/restaurants', {
      name: 'La Trattoria',
      // missing slug and address
    });

    const res = await createRestaurant(ctx(req));
    expect(res.status).toBe(400);

    const data = await asRecord(res);
    expect(data.error).toBe('Validation failed');
    expect(data.details).toBeDefined();
  });

  it('GET /api/restaurants - lists active restaurants', async () => {
    await createRestaurant(
      ctx(
        json('POST', 'http://localhost/api/restaurants', {
          name: 'Bistro 21',
          slug: 'bistro-21',
          address: 'Av. Diagonal 400',
        }),
      ),
    );

    const res = await listRestaurants(ctx(new Request('http://localhost/api/restaurants')));
    expect(res.status).toBe(200);

    const list = (await res.json()) as Array<{ name: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Bistro 21');
  });

  it('GET /api/restaurants/[id] - retrieves restaurant by ID', async () => {
    const createRes = await createRestaurant(
      ctx(
        json('POST', 'http://localhost/api/restaurants', {
          name: 'Tapas Bar',
          slug: 'tapas-bar',
          address: 'Plaza Real 5',
        }),
      ),
    );
    const created = await asRecord(createRes);

    const getReq = new Request(`http://localhost/api/restaurants/${created.id}`);
    const res = await getRestaurant(ctx(getReq, { id: String(created.id) }));
    expect(res.status).toBe(200);

    const got = await asRecord(res);
    expect(got.id).toBe(created.id);
    expect(got.name).toBe('Tapas Bar');
  });

  it('GET /api/restaurants/[id] - returns 404 if restaurant does not exist', async () => {
    const getReq = new Request('http://localhost/api/restaurants/non-existent-id');
    const res = await getRestaurant(ctx(getReq, { id: 'non-existent-id' }));
    expect(res.status).toBe(404);
  });

  it('PATCH /api/restaurants/[id] - updates restaurant details', async () => {
    const createRes = await createRestaurant(
      ctx(
        json('POST', 'http://localhost/api/restaurants', {
          name: 'Pizzeria',
          slug: 'pizzeria',
          address: 'Calle Roma 8',
        }),
      ),
    );
    const created = await asRecord(createRes);

    const patchReq = json('PATCH', `http://localhost/api/restaurants/${created.id}`, { name: 'Pizzeria Napoli' });

    const res = await updateRestaurant(ctx(patchReq, { id: String(created.id) }));
    expect(res.status).toBe(200);

    const updated = await asRecord(res);
    expect(updated.name).toBe('Pizzeria Napoli');
    expect(updated.slug).toBe('pizzeria');
  });

  it('DELETE /api/restaurants/[id] - soft deletes restaurant', async () => {
    const createRes = await createRestaurant(
      ctx(
        json('POST', 'http://localhost/api/restaurants', {
          name: 'Sushi Zen',
          slug: 'sushi-zen',
          address: 'Gran Via 100',
        }),
      ),
    );
    const created = await asRecord(createRes);

    const deleteReq = new Request(`http://localhost/api/restaurants/${created.id}`, { method: 'DELETE' });

    const delRes = await deleteRestaurant(ctx(deleteReq, { id: String(created.id) }));
    expect(delRes.status).toBe(200);

    // List should now be empty
    const listRes = await listRestaurants(ctx(new Request('http://localhost/api/restaurants')));
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(0);

    // GET by ID should return 404
    const getReq = new Request(`http://localhost/api/restaurants/${created.id}`);
    const getRes = await getRestaurant(ctx(getReq, { id: String(created.id) }));
    expect(getRes.status).toBe(404);
  });

  it('isolates restaurants by the instance of the session', async () => {
    const asInstance = (instanceId: string, req: Request) =>
      apiContext({ request: req, params: {}, user: mockUser, instanceId });
    const create = (slug: string, instanceId: string, query = '') =>
      createRestaurant(
        asInstance(
          instanceId,
          json('POST', `http://localhost/api/restaurants${query}`, { name: `Resto ${slug}`, slug, address: `Addr ${slug}` }),
        ),
      );

    expect((await create('resto-a', 'inst-1')).status).toBe(201);

    const list1 = (await (
      await listRestaurants(asInstance('inst-1', new Request('http://localhost/api/restaurants?instance_id=inst-1')))
    ).json()) as unknown[];
    expect(list1).toHaveLength(1);

    const list2 = (await (
      await listRestaurants(asInstance('inst-2', new Request('http://localhost/api/restaurants?instance_id=inst-2')))
    ).json()) as unknown[];
    expect(list2).toHaveLength(0);

    // A session of inst-2 cannot create into inst-1, by query or by body.
    expect((await create('resto-b', 'inst-2', '?instance_id=inst-1')).status).toBe(403);
    const bodyReq = json('POST', 'http://localhost/api/restaurants', {
      name: 'Resto C',
      slug: 'resto-c',
      address: 'Addr C',
      instance_id: 'inst-1',
    });
    expect((await createRestaurant(asInstance('inst-2', bodyReq))).status).toBe(403);
    expect(await getMemoryAdapter().list('restaurant', 'inst-1')).toHaveLength(1);

    // And cannot edit or delete inst-1's restaurant.
    const [existing] = await getMemoryAdapter().list('restaurant', 'inst-1');
    const patch = json('PATCH', `http://localhost/api/restaurants/${existing.id}?instance_id=inst-1`, { name: 'Hackeado' });
    const patchRes = await updateRestaurant(
      apiContext({ request: patch, params: { id: existing.id }, user: mockUser, instanceId: 'inst-2' }),
    );
    expect(patchRes.status).toBe(403);
    const del = new Request(`http://localhost/api/restaurants/${existing.id}?instance_id=inst-1`, { method: 'DELETE' });
    expect(
      (await deleteRestaurant(apiContext({ request: del, params: { id: existing.id }, user: mockUser, instanceId: 'inst-2' }))).status,
    ).toBe(403);
    const record = await getMemoryAdapter().get('restaurant', existing.id, 'inst-1');
    expect(record?.name).toBe('Resto resto-a');
  });
});

describe('Restaurants API - WhatsApp (phone)', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  it('POST normaliza el WhatsApp a digitos con indicativo', async () => {
    const res = await createRestaurant(
      ctx(json('POST', 'http://localhost/api/restaurants', { name: 'Wa', slug: 'wa-uno', address: 'Calle 1', phone: '+57 300 123 4567' })),
    );
    expect(res.status).toBe(201);
    expect((await asRecord(res)).phone).toBe('573001234567');
  });

  it('POST rechaza un WhatsApp invalido con mensaje en español', async () => {
    const res = await createRestaurant(
      ctx(json('POST', 'http://localhost/api/restaurants', { name: 'Wa', slug: 'wa-dos', address: 'Calle 1', phone: '12345' })),
    );
    expect(res.status).toBe(400);
    expect(String((await asRecord(res)).error)).toMatch(/WhatsApp/);
  });

  it('PATCH guarda el WhatsApp normalizado, lo valida y permite quitarlo', async () => {
    const created = await asRecord(
      await createRestaurant(ctx(json('POST', 'http://localhost/api/restaurants', { name: 'Wa', slug: 'wa-tres', address: 'Calle 1' }))),
    );
    const patch = (body: unknown) =>
      updateRestaurant(ctx(json('PATCH', `http://localhost/api/restaurants/${created.id}`, body), { id: String(created.id) }));

    const ok = await patch({ phone: '3001234567' });
    expect(ok.status).toBe(200);
    expect((await asRecord(ok)).phone).toBe('573001234567');

    const bad = await patch({ phone: 'abc' });
    expect(bad.status).toBe(400);
    expect(String((await asRecord(bad)).error)).toMatch(/WhatsApp/);

    const cleared = await patch({ phone: '' });
    expect(cleared.status).toBe(200);
    expect((await asRecord(cleared)).phone).toBe('');
  });
});

describe('Restaurants API - slug', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const create = (slug: string, instance = '') =>
    createRestaurant(ctx(json('POST', `http://localhost/api/restaurants${instance}`, { name: 'R', slug, address: 'Calle 1' })));

  it('POST rechaza formato, largo y reservados con 400 y mensaje en español', async () => {
    for (const slug of ['Mi Resto', 'ab', 'a'.repeat(61), '-x-', 'api', 'dashboard', 'order-confirmation', 'menu']) {
      const res = await create(slug);
      expect(res.status, slug).toBe(400);
      expect(typeof (await asRecord(res)).error).toBe('string');
    }
  });

  it('POST responde 409 si el slug ya existe en la instancia', async () => {
    expect((await create('el-rincon')).status).toBe(201);
    const dup = await create('el-rincon');
    expect(dup.status).toBe(409);
    expect(String((await asRecord(dup)).error)).toMatch(/ya está en uso/);
  });

  it('un restaurante borrado libera su slug', async () => {
    const first = await asRecord(await create('liberado'));
    await deleteRestaurant(ctx(json('DELETE', `http://localhost/api/restaurants/${first.id}`, {}), { id: String(first.id) }));
    expect((await create('liberado')).status).toBe(201);
  });

  it('PATCH valida el slug, devuelve 409 si es de otro y permite conservar el propio', async () => {
    const a = await asRecord(await create('resto-a1'));
    const b = await asRecord(await create('resto-b1'));
    const patch = (id: string, body: unknown) =>
      updateRestaurant(ctx(json('PATCH', `http://localhost/api/restaurants/${id}`, body), { id }));

    expect((await patch(String(b.id), { slug: 'resto-a1' })).status).toBe(409);
    expect((await patch(String(b.id), { slug: 'login' })).status).toBe(400);
    expect((await patch(String(b.id), { slug: 'Resto B' })).status).toBe(400);
    expect((await patch(String(b.id), { slug: 'resto-b1', name: 'B' })).status).toBe(200);
    const renamed = await patch(String(a.id), { slug: 'resto-a2' });
    expect(renamed.status).toBe(200);
    expect((await asRecord(renamed)).slug).toBe('resto-a2');
  });
});
