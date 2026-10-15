// FEAT-005 — aislamiento por tenant. El tenant sale de la sesion (locals.instanceId, que fija el middleware),
// nunca de `?instance_id=` ni del body. Mismo usuario, instancia ajena -> 403; instancia propia -> permitido.
// Las rutas publicas (qr/public-order/menu-nutrition) no tienen sesion: IGNORAN el query y sirven la
// instancia del despliegue. Las de compras/recetas/proveedores tambien ignoran el query (usan locals).
import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listInventory, POST as createInventory } from '../pages/api/inventory/index';
import { GET as getInventory, PATCH as patchInventory, DELETE as deleteInventory } from '../pages/api/inventory/[id]';
import { GET as listTx, POST as postTx } from '../pages/api/inventory/[id]/transactions';
import { GET as listTables, POST as createTable } from '../pages/api/tables/index';
import { GET as getTable, PATCH as patchTable } from '../pages/api/tables/[id]';
import { GET as listOrders, POST as createOrder } from '../pages/api/orders/index';
import { GET as getOrder, PATCH as patchOrder } from '../pages/api/orders/[id]';
import { POST as transitionOrder } from '../pages/api/orders/[id]/transition';
import { POST as payOrder } from '../pages/api/orders/[id]/payment';
import { POST as createMenuItem } from '../pages/api/menu-items/index';
import { POST as createCategory } from '../pages/api/categories/index';
import { POST as resetData } from '../pages/api/reset-data/index';
import { GET as listRestaurants, POST as createRestaurant } from '../pages/api/restaurants/index';
import { GET as getRestaurant } from '../pages/api/restaurants/[id]';
import { GET as listNotifications, POST as createNotification } from '../pages/api/notifications/index';
import { GET as listSuppliers } from '../pages/api/suppliers/index';
import { GET as listRecipes } from '../pages/api/recipes/index';
import { GET as listPurchases } from '../pages/api/purchases/index';
import { GET as resolveQr } from '../pages/api/qr/[code]';
import { GET as getPublicOrder } from '../pages/api/public-order/[id]';
import { GET as publicNutrition } from '../pages/api/menu-nutrition';
import { onRequest } from '../middleware';
import { getMemoryAdapter, type DomainRecord } from './domain';
import { createUser, createSession, type SessionUser } from './auth/session';
import { domainConfig } from './domain.config';
import { resolveTenant, tenantOf } from './auth/tenant';
import { apiContext, jsonRequest } from './testing/apiContext';

const OWN = domainConfig.instanceId ?? 'default';
const OTHER = 'otro-restaurante';
const owner: SessionUser = { id: 'u-owner', email: 'owner@fize.app', name: 'Dueno', role: 'owner' };

// Lo que hace el middleware tras resolver la sesion: locals.instanceId = instancia de la sesion.
const ctx = (req: Request, params: Record<string, string> = {}, instanceId: string | undefined = OWN) =>
  apiContext({ request: req, params, user: owner, instanceId });

const now = () => new Date().toISOString();

async function seed(instance: string, entity: string, id: string, extra: Record<string, unknown> = {}): Promise<DomainRecord> {
  return getMemoryAdapter().create(entity, {
    id,
    instance_id: instance,
    created_at: now(),
    updated_at: now(),
    ...extra,
  });
}

const jsonArray = async <T>(res: Response): Promise<T[]> => (await res.json()) as T[];
const jsonObject = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

beforeEach(async () => {
  getMemoryAdapter().clear();
  await seed(OWN, 'inventoryItem', 'inv-own', { name: 'Harina propia', unit: 'kg', stock: 5, minStock: 1 });
  await seed(OTHER, 'inventoryItem', 'inv-foreign', { name: 'Harina ajena', unit: 'kg', stock: 9, minStock: 1 });
  await seed(OWN, 'table', 'tab-own', { number: 1, capacity: 4, qrCode: 'qr-own' });
  await seed(OTHER, 'table', 'tab-foreign', { number: 7, capacity: 2, qrCode: 'qr-foreign' });
  await seed(OWN, 'menuItem', 'mi-own', { name: 'Arepa', price: 5000 });
  await seed(OTHER, 'menuItem', 'mi-foreign', { name: 'Ajiaco', price: 9000 });
  await seed(OWN, 'order', 'ord-own', { tableId: 'tab-own', status: 'pending', items: [] });
  await seed(OTHER, 'order', 'ord-foreign', { tableId: 'tab-foreign', status: 'pending', items: [] });
  await seed(OWN, 'restaurant', 'rest-own', { name: 'Propio', slug: 'propio', address: 'Calle 1' });
  await seed(OTHER, 'restaurant', 'rest-foreign', { name: 'Ajeno', slug: 'ajeno', address: 'Calle 2' });
  await seed(OWN, 'notification', 'not-own', { title: 'Propio', message: 'm', type: 'info', priority: 'normal', userId: owner.id });
  await seed(OTHER, 'notification', 'not-foreign', { title: 'Ajeno', message: 'm', type: 'info', priority: 'normal', userId: owner.id });
  await seed(OWN, 'supplier', 'sup-own', { name: 'Proveedor propio', isActive: true });
  await seed(OTHER, 'supplier', 'sup-foreign', { name: 'Proveedor ajeno', isActive: true });
  await seed(OWN, 'recipe', 'rec-own', { name: 'Receta propia', menuItemId: 'mi-own', costPerServing: 1 });
  await seed(OTHER, 'recipe', 'rec-foreign', { name: 'Receta ajena', menuItemId: 'mi-foreign', costPerServing: 1 });
  await seed(OWN, 'purchase', 'pur-own', { supplierId: 'sup-own', invoiceNumber: 'F-1', invoiceDate: '2026-10-01', lines: [] });
  await seed(OTHER, 'purchase', 'pur-foreign', { supplierId: 'sup-foreign', invoiceNumber: 'F-2', invoiceDate: '2026-10-01', lines: [] });
});

const forbidden = async (res: Response) => {
  expect(res.status).toBe(403);
  const body = JSON.stringify(await res.json());
  expect(body).not.toContain('ajena');
  expect(body).not.toContain('foreign');
};

describe('helper de tenant', () => {
  it('el tenant es locals.instanceId; sin middleware, la instancia del despliegue', () => {
    expect(tenantOf({ instanceId: 'acme' })).toBe('acme');
    expect(tenantOf({})).toBe(OWN);
    expect(tenantOf(undefined)).toBe(OWN);
  });

  it('una instancia pedida distinta es 403; igual o ausente se acepta', () => {
    const locals = { instanceId: 'acme' };
    expect(resolveTenant(locals, new Request('http://x/api/a'))).toBe('acme');
    expect(resolveTenant(locals, new Request('http://x/api/a?instance_id=acme'))).toBe('acme');
    expect(() => resolveTenant(locals, new Request('http://x/api/a?instance_id=otra'))).toThrow(/does not match/);
    expect(() => resolveTenant(locals, new Request('http://x/api/a'), 'otra')).toThrow(/does not match/);
  });
});

describe('inventario', () => {
  it('GET con instancia propia (explicita o implicita) devuelve solo lo propio', async () => {
    for (const q of ['', `?instance_id=${OWN}`]) {
      const res = await listInventory(ctx(jsonRequest(`http://x/api/inventory${q}`, 'GET')));
      expect(res.status).toBe(200);
      const rows = await jsonArray<{ id: string }>(res);
      expect(rows.map((r) => r.id)).toEqual(['inv-own']);
    }
  });

  it('GET con instance_id ajeno -> 403 y sin datos', async () => {
    await forbidden(await listInventory(ctx(jsonRequest(`http://x/api/inventory?instance_id=${OTHER}`, 'GET'))));
  });

  it('POST con instance_id ajeno en query o body -> 403 y no escribe en la instancia ajena', async () => {
    const payload = { name: 'Intruso', unit: 'kg' };
    await forbidden(await createInventory(ctx(jsonRequest(`http://x/api/inventory?instance_id=${OTHER}`, 'POST', payload))));
    await forbidden(await createInventory(ctx(jsonRequest('http://x/api/inventory', 'POST', { ...payload, instance_id: OTHER }))));
    const foreign = await getMemoryAdapter().list('inventoryItem', OTHER);
    expect(foreign.map((r) => r.id)).toEqual(['inv-foreign']);
  });

  it('POST propio se crea en la instancia de la sesion', async () => {
    const res = await createInventory(ctx(jsonRequest('http://x/api/inventory', 'POST', { name: 'Sal', unit: 'kg', instance_id: OWN })));
    expect(res.status).toBe(201);
    expect((await jsonObject(res)).instance_id).toBe(OWN);
  });

  it('el tenant sigue a la sesion: sesion de otra instancia no ve la del despliegue', async () => {
    const res = await listInventory(ctx(jsonRequest('http://x/api/inventory', 'GET'), {}, OTHER));
    expect((await jsonArray<{ id: string }>(res)).map((r) => r.id)).toEqual(['inv-foreign']);
    await forbidden(await listInventory(ctx(jsonRequest(`http://x/api/inventory?instance_id=${OWN}`, 'GET'), {}, OTHER)));
  });

  it('[id]: leer, editar y borrar un item ajeno por instance_id -> 403 y el item no cambia', async () => {
    const q = `?instance_id=${OTHER}`;
    await forbidden(await getInventory(ctx(jsonRequest(`http://x/api/inventory/inv-foreign${q}`, 'GET'), { id: 'inv-foreign' })));
    await forbidden(
      await patchInventory(ctx(jsonRequest(`http://x/api/inventory/inv-foreign${q}`, 'PATCH', { name: 'hackeado' }), { id: 'inv-foreign' })),
    );
    await forbidden(await deleteInventory(ctx(jsonRequest(`http://x/api/inventory/inv-foreign${q}`, 'DELETE'), { id: 'inv-foreign' })));
    const rec = await getMemoryAdapter().get('inventoryItem', 'inv-foreign', OTHER);
    expect(rec?.name).toBe('Harina ajena');
    expect(rec?.deleted_at).toBeUndefined();
  });

  it('[id]: el mismo id sin instance_id no alcanza el item ajeno (404 en la instancia propia)', async () => {
    const res = await getInventory(ctx(jsonRequest('http://x/api/inventory/inv-foreign', 'GET'), { id: 'inv-foreign' }));
    expect(res.status).toBe(404);
  });

  it('transacciones: historial y movimiento sobre instancia ajena -> 403', async () => {
    const q = `?instance_id=${OTHER}`;
    await forbidden(await listTx(ctx(jsonRequest(`http://x/api/inventory/inv-foreign/transactions${q}`, 'GET'), { id: 'inv-foreign' })));
    await forbidden(
      await postTx(
        ctx(jsonRequest(`http://x/api/inventory/inv-foreign/transactions${q}`, 'POST', { kind: 'use', qty: 1 }), { id: 'inv-foreign' }),
      ),
    );
    const rec = await getMemoryAdapter().get('inventoryItem', 'inv-foreign', OTHER);
    expect(rec?.stock).toBe(9);
  });
});

describe('mesas', () => {
  it('GET propio ok, GET ajeno 403', async () => {
    const own = await listTables(ctx(jsonRequest(`http://x/api/tables?instance_id=${OWN}`, 'GET')));
    expect(own.status).toBe(200);
    expect((await jsonArray<{ id: string }>(own)).map((t) => t.id)).toEqual(['tab-own']);
    await forbidden(await listTables(ctx(jsonRequest(`http://x/api/tables?instance_id=${OTHER}`, 'GET'))));
  });

  it('POST ajeno (query o body) -> 403; propio -> 201', async () => {
    await forbidden(await createTable(ctx(jsonRequest(`http://x/api/tables?instance_id=${OTHER}`, 'POST', { number: 9, capacity: 2 }))));
    await forbidden(await createTable(ctx(jsonRequest('http://x/api/tables', 'POST', { number: 9, capacity: 2, instance_id: OTHER }))));
    expect(await getMemoryAdapter().list('table', OTHER)).toHaveLength(1);
    const ok = await createTable(ctx(jsonRequest('http://x/api/tables', 'POST', { number: 9, capacity: 2 })));
    expect(ok.status).toBe(201);
    expect((await jsonObject(ok)).instance_id).toBe(OWN);
  });

  it('[id]: GET y PATCH ajeno -> 403', async () => {
    const q = `?instance_id=${OTHER}`;
    await forbidden(await getTable(ctx(jsonRequest(`http://x/api/tables/tab-foreign${q}`, 'GET'), { id: 'tab-foreign' })));
    await forbidden(await patchTable(ctx(jsonRequest(`http://x/api/tables/tab-foreign${q}`, 'PATCH', { capacity: 99 }), { id: 'tab-foreign' })));
    const rec = await getMemoryAdapter().get('table', 'tab-foreign', OTHER);
    expect(rec?.capacity).toBe(2);
  });
});

describe('pedidos', () => {
  it('GET propio ok, GET ajeno 403', async () => {
    const own = await listOrders(ctx(jsonRequest('http://x/api/orders', 'GET')));
    expect((await jsonArray<{ id: string }>(own)).map((o) => o.id)).toEqual(['ord-own']);
    await forbidden(await listOrders(ctx(jsonRequest(`http://x/api/orders?instance_id=${OTHER}`, 'GET'))));
  });

  it('POST de invitado (sin sesion) no puede escribir en otra instancia', async () => {
    const guest = (url: string, body: unknown) =>
      apiContext({ request: jsonRequest(url, 'POST', body), params: {}, user: null, instanceId: OWN });
    const items = [{ menuItemId: 'mi-foreign', qty: 1 }];
    await forbidden(await createOrder(guest(`http://x/api/orders?instance_id=${OTHER}`, { tableId: 'tab-foreign', items })));
    await forbidden(await createOrder(guest('http://x/api/orders', { tableId: 'tab-foreign', items, instance_id: OTHER })));
    expect(await getMemoryAdapter().list('order', OTHER)).toHaveLength(1);
    const ok = await createOrder(guest('http://x/api/orders', { tableId: 'tab-own', items: [{ menuItemId: 'mi-own', qty: 2 }] }));
    expect(ok.status).toBe(201);
    expect((await jsonObject(ok)).instance_id).toBe(OWN);
  });

  it('[id], transicion y pago sobre pedido ajeno -> 403 y el pedido no cambia', async () => {
    const q = `?instance_id=${OTHER}`;
    const p = { id: 'ord-foreign' };
    await forbidden(await getOrder(ctx(jsonRequest(`http://x/api/orders/ord-foreign${q}`, 'GET'), p)));
    await forbidden(await patchOrder(ctx(jsonRequest(`http://x/api/orders/ord-foreign${q}`, 'PATCH', { note: 'x' }), p)));
    await forbidden(await transitionOrder(ctx(jsonRequest(`http://x/api/orders/ord-foreign/transition${q}`, 'POST', { to: 'preparing' }), p)));
    await forbidden(
      await payOrder(ctx(jsonRequest(`http://x/api/orders/ord-foreign/payment${q}`, 'POST', { amount: 1, method: 'efectivo' }), p)),
    );
    await forbidden(
      await payOrder(ctx(jsonRequest('http://x/api/orders/ord-foreign/payment', 'POST', { amount: 1, method: 'efectivo', instance_id: OTHER }), p)),
    );
    const rec = await getMemoryAdapter().get('order', 'ord-foreign', OTHER);
    expect(rec?.status).toBe('pending');
  });
});

describe('carta y reinicio de datos', () => {
  it('crear plato o categoria en instancia ajena -> 403', async () => {
    await forbidden(
      await createMenuItem(ctx(jsonRequest(`http://x/api/menu-items?instance_id=${OTHER}`, 'POST', { name: 'X', price: 1, categoryId: 'c' }))),
    );
    await forbidden(await createCategory(ctx(jsonRequest('http://x/api/categories', 'POST', { name: 'X', instance_id: OTHER }))));
    expect(await getMemoryAdapter().list('menuItem', OTHER)).toHaveLength(1);
    expect(await getMemoryAdapter().list('category', OTHER)).toHaveLength(0);
  });

  it('reset-data con instance_id ajeno -> 403 y no borra nada', async () => {
    const res = await resetData(
      ctx(jsonRequest(`http://x/api/reset-data?instance_id=${OTHER}`, 'POST', { confirm: true, instance_id: OTHER })),
    );
    expect(res.status).toBe(403);
    expect(await getMemoryAdapter().list('inventoryItem', OTHER)).toHaveLength(1);
  });
});

describe('restaurantes', () => {
  it('GET /api/restaurants usa el tenant de la sesion y rechaza el instance_id ajeno', async () => {
    const own = await listRestaurants(ctx(jsonRequest('http://x/api/restaurants', 'GET')));
    expect(own.status).toBe(200);
    expect((await jsonArray<{ id: string }>(own)).map((r) => r.id)).toEqual(['rest-own']);
    await forbidden(await listRestaurants(ctx(jsonRequest(`http://x/api/restaurants?instance_id=${OTHER}`, 'GET'))));
  });

  it('GET /api/restaurants no honra el query: con el instance_id de la propia sesion solo devuelve lo propio', async () => {
    const res = await listRestaurants(ctx(jsonRequest(`http://x/api/restaurants?instance_id=${OWN}`, 'GET')));
    expect(res.status).toBe(200);
    expect((await jsonArray<{ id: string }>(res)).map((r) => r.id)).toEqual(['rest-own']);
  });

  it('GET /api/restaurants/[id] de otra instancia -> 403 (no 200 con datos ajenos)', async () => {
    await forbidden(
      await getRestaurant(ctx(jsonRequest(`http://x/api/restaurants/rest-foreign?instance_id=${OTHER}`, 'GET'), { id: 'rest-foreign' })),
    );
  });

  it('POST ajeno (query o body) -> 403; en la sesion propia -> 201', async () => {
    const payload = { name: 'Nuevo', slug: 'nuevo-resto', address: 'Calle 3' };
    await forbidden(await createRestaurant(ctx(jsonRequest(`http://x/api/restaurants?instance_id=${OTHER}`, 'POST', payload))));
    await forbidden(await createRestaurant(ctx(jsonRequest('http://x/api/restaurants', 'POST', { ...payload, instance_id: OTHER }))));
    expect(await getMemoryAdapter().list('restaurant', OTHER)).toHaveLength(1);
    const ok = await createRestaurant(ctx(jsonRequest('http://x/api/restaurants', 'POST', payload)));
    expect(ok.status).toBe(201);
    expect((await jsonObject(ok)).instance_id).toBe(OWN);
  });
});

describe('avisos', () => {
  it('GET propio ok, GET ajeno 403', async () => {
    const own = await listNotifications(ctx(jsonRequest('http://x/api/notifications', 'GET')));
    expect(own.status).toBe(200);
    const body = await jsonObject(own);
    expect((body.notifications as Array<{ id: string }>).map((n) => n.id)).toEqual(['not-own']);
    await forbidden(await listNotifications(ctx(jsonRequest(`http://x/api/notifications?instance_id=${OTHER}`, 'GET'))));
  });

  it('POST con instance_id ajeno (query o body) -> 403 y no escribe en la otra instancia', async () => {
    const payload = { title: 'X', message: 'Y', type: 'info' };
    await forbidden(await createNotification(ctx(jsonRequest(`http://x/api/notifications?instance_id=${OTHER}`, 'POST', payload))));
    await forbidden(await createNotification(ctx(jsonRequest('http://x/api/notifications', 'POST', { ...payload, instance_id: OTHER }))));
    expect(await getMemoryAdapter().list('notification', OTHER)).toHaveLength(1);
  });
});

describe('compras, recetas y proveedores: ignoran el instance_id del cliente', () => {
  it('suppliers GET usa la sesion aunque el query pida otra instancia', async () => {
    const res = await listSuppliers(ctx(jsonRequest(`http://x/api/suppliers?instance_id=${OTHER}`, 'GET')));
    expect(res.status).toBe(200);
    expect((await jsonArray<{ id: string }>(res)).map((s) => s.id)).toEqual(['sup-own']);
  });

  it('recipes GET usa la sesion aunque el query pida otra instancia', async () => {
    const res = await listRecipes(ctx(jsonRequest(`http://x/api/recipes?instance_id=${OTHER}`, 'GET')));
    expect(res.status).toBe(200);
    expect((await jsonArray<{ id: string }>(res)).map((r) => r.id)).toEqual(['rec-own']);
  });

  it('purchases GET usa la sesion aunque el query pida otra instancia', async () => {
    const res = await listPurchases(ctx(jsonRequest(`http://x/api/purchases?instance_id=${OTHER}`, 'GET')));
    expect(res.status).toBe(200);
    expect((await jsonArray<{ id: string }>(res)).map((p) => p.id)).toEqual(['pur-own']);
  });
});

describe('rutas publicas: el query no elige la instancia', () => {
  it('GET /api/qr/[code] sirve la mesa del despliegue y no la que pide el query', async () => {
    const res = await resolveQr(
      apiContext({
        request: new Request(`http://x/api/qr/qr-own?instance_id=${OTHER}`),
        params: { code: 'qr-own' },
        user: null,
        instanceId: OWN,
      }),
    );
    expect(res.status).toBe(200);
    const table = (await jsonObject(res)).table as { id: string };
    expect(table.id).toBe('tab-own');
  });

  it('GET /api/public-order/[id] lee el pedido del despliegue y no el del query', async () => {
    await seed(OWN, 'order', 'ord-public-0001', { tableId: 'tab-own', status: 'pending', items: [] });
    const res = await getPublicOrder(
      apiContext({
        request: new Request(`http://x/api/public-order/ord-public-0001?instance_id=${OTHER}`),
        params: { id: 'ord-public-0001' },
        user: null,
        instanceId: OWN,
      }),
    );
    expect(res.status).toBe(200);
    expect((await jsonObject(res)).status).toBe('pending');
  });

  it('GET /api/menu-nutrition busca la carta en la instancia del despliegue (no 404 aunque el query pida otra)', async () => {
    // `propio` solo existe en la instancia OWN: si la ruta honrara el query, no encontraria el restaurante y
    // devolveria 404. Con el tenant del despliegue encuentra la carta (y la nutricion opcional cae a 200/503).
    const res = await publicNutrition(
      apiContext({
        request: new Request(`http://x/api/menu-nutrition?slug=propio&instance_id=${OTHER}`),
        user: null,
        instanceId: OWN,
      }),
    );
    expect(res.status).not.toBe(404);
  });
});

describe('middleware: el tenant no sale del query string', () => {
  const run = async (url: string, token?: string) => {
    const context = apiContext({
      request: new Request(url),
      user: null,
      cookies: token ? { fize_session: token } : {},
    });
    await onRequest(context, async () => new Response('ok'));
    return context.locals;
  };

  it('locals.instanceId es la instancia del despliegue aunque el query pida otra', async () => {
    const adapter = getMemoryAdapter();
    const u = await createUser(adapter, OWN, { email: 'o@fize.app', name: 'O', password: 'password-123', role: 'owner' });
    const token = await createSession(adapter, OWN, u.id);

    const plain = await run('http://localhost/api/inventory', token);
    expect(plain.user?.id).toBe(u.id);
    expect(plain.instanceId).toBe(OWN);

    const spoofed = await run(`http://localhost/api/inventory?instance_id=${OTHER}`, token);
    expect(spoofed.instanceId).toBe(OWN);
    expect(spoofed.user?.id).toBe(u.id);
  });

  it('una sesion de otra instancia no autentica pidiendo ?instance_id= de esa instancia', async () => {
    const adapter = getMemoryAdapter();
    const foreignUser = await createUser(adapter, OTHER, { email: 'x@otro.app', name: 'X', password: 'password-123', role: 'owner' });
    const foreignToken = await createSession(adapter, OTHER, foreignUser.id);
    const res = await run(`http://localhost/api/inventory?instance_id=${OTHER}`, foreignToken);
    expect(res.user).toBeNull();
    expect(res.instanceId).toBe(OWN);
  });
});
