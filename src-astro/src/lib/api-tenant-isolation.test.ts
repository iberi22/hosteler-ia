// FEAT-005 — aislamiento por tenant. El tenant sale de la sesion (locals.instanceId, que fija el middleware),
// nunca de `?instance_id=` ni del body. Mismo usuario, instancia ajena -> 403; instancia propia -> permitido.
// El `instance_id` del body tambien se comprueba (Zod lo descartaria en silencio). Las rutas publicas
// (qr/public-order/menu-nutrition/restaurants GET/orders POST de invitado) no tienen sesion: IGNORAN el
// query y sirven la instancia del despliegue. Compras/recetas/proveedores rechazan el query ajeno con 403.
import { describe, it, expect, beforeEach } from 'vitest';
import type { APIRoute } from 'astro';
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
import { PATCH as patchMenuItem } from '../pages/api/menu-items/[id]';
import { POST as createCategory } from '../pages/api/categories/index';
import { PATCH as patchCategory } from '../pages/api/categories/[id]';
import { POST as resetData } from '../pages/api/reset-data/index';
import { GET as listRestaurants, POST as createRestaurant } from '../pages/api/restaurants/index';
import { GET as getRestaurant, PATCH as patchRestaurant } from '../pages/api/restaurants/[id]';
import { GET as listNotifications, POST as createNotification } from '../pages/api/notifications/index';
import { PATCH as patchNotification } from '../pages/api/notifications/[id]';
import { GET as listSuppliers, POST as createSupplier } from '../pages/api/suppliers/index';
import { GET as listRecipes, POST as createRecipe } from '../pages/api/recipes/index';
import { GET as listPurchases, POST as createPurchase } from '../pages/api/purchases/index';
import { GET as resolveQr } from '../pages/api/qr/[code]';
import { GET as getPublicOrder } from '../pages/api/public-order/[id]';
import { GET as publicNutrition } from '../pages/api/menu-nutrition';
import { onRequest } from '../middleware';
import { getMemoryAdapter, type DomainRecord } from './domain';
import { createUser, createSession, type SessionUser } from './auth/session';
import { domainConfig } from './domain.config';
import {
  resolveTenant,
  tenantOf,
  bodyTenant,
  requestTenant,
  resolveRequestTenant,
  resolvePublicTenant,
} from './auth/tenant';
import { apiContext, jsonRequest } from './testing/apiContext';

const OWN = domainConfig.instanceId ?? 'default';
const OTHER = 'otro-restaurante';
const owner: SessionUser = { id: 'u-owner', email: 'owner@fize.app', name: 'Dueno', role: 'owner' };

// Lo que hace el middleware tras resolver la sesion: locals.instanceId = instancia de la sesion.
const ctx = (req: Request, params: Record<string, string> = {}, instanceId: string | undefined = OWN) =>
  apiContext({ request: req, params, user: owner, instanceId });

// Contexto SIN `locals.instanceId` (sin middleware delante): el resolver debe caer a la instancia del
// despliegue y seguir sin usar nunca el valor del cliente.
const ctxNoLocals = (req: Request, params: Record<string, string> = {}) =>
  apiContext({ request: req, params, user: owner, omitInstanceId: true });

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

  it('el `instance_id` del body se lee crudo, antes de que Zod lo descarte', async () => {
    expect(bodyTenant({ instance_id: 'acme' })).toBe('acme');
    expect(bodyTenant({ instance_id: '' })).toBeNull();
    expect(bodyTenant({ instance_id: 7 })).toBeNull();
    expect(bodyTenant(null)).toBeNull();
    expect(bodyTenant([])).toBeNull();

    const req = jsonRequest('http://x/api/a', 'POST', { name: 'x', instance_id: 'otra' });
    expect(await requestTenant(req)).toBe('otra');
    // El clon no consume el cuerpo: el handler lo puede leer despues.
    expect(await req.json()).toEqual({ name: 'x', instance_id: 'otra' });
    expect(await requestTenant(new Request('http://x/api/a', { method: 'POST' }))).toBeNull();
  });

  it('resolveRequestTenant rechaza el instance_id ajeno del body y acepta el propio', async () => {
    const locals = { instanceId: 'acme' };
    const body = (v: string) => jsonRequest('http://x/api/a', 'POST', { name: 'x', instance_id: v });
    await expect(resolveRequestTenant(locals, body('otra'))).rejects.toThrow(/does not match/);
    expect(await resolveRequestTenant(locals, body('acme'))).toBe('acme');
  });

  it('sin locals.instanceId el resolver usa el despliegue y jamas el instance_id del cliente', async () => {
    expect(tenantOf({})).toBe(OWN);
    await expect(resolveRequestTenant({}, new Request(`http://x/api/a?instance_id=${OTHER}`))).rejects.toThrow(/does not match/);
    expect(await resolveRequestTenant({}, new Request('http://x/api/a'))).toBe(OWN);
    await expect(
      resolveRequestTenant({}, jsonRequest('http://x/api/a', 'PATCH', { instance_id: OTHER })),
    ).rejects.toThrow(/does not match/);
  });

  it('la ruta publica no mira el query: sirve la instancia del despliegue', () => {
    expect(resolvePublicTenant({})).toBe(OWN);
    expect(resolvePublicTenant({ instanceId: 'acme' })).toBe('acme');
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

  it('POST de invitado (sin sesion) IGNORA el instance_id ajeno y opera solo en el despliegue', async () => {
    const guest = (url: string, body: unknown) =>
      apiContext({ request: jsonRequest(url, 'POST', body), params: {}, user: null, instanceId: OWN });
    const items = [{ menuItemId: 'mi-own', qty: 2 }];
    // La mesa ajena no existe en el despliegue: si la ruta honrara el tenant del cliente, la encontraria.
    const foreignTable = await createOrder(guest(`http://x/api/orders?instance_id=${OTHER}`, { tableId: 'tab-foreign', items }));
    expect(foreignTable.status).toBe(422);
    expect(await getMemoryAdapter().list('order', OTHER)).toHaveLength(1);

    // Con `instance_id` ajeno en el body tampoco escribe fuera: crea en el despliegue.
    const ok = await createOrder(guest('http://x/api/orders', { tableId: 'tab-own', items, instance_id: OTHER }));
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
  it('GET /api/restaurants es publico: ignora el instance_id ajeno y sirve el despliegue', async () => {
    for (const q of ['', `?instance_id=${OWN}`, `?instance_id=${OTHER}`]) {
      const res = await listRestaurants(ctx(jsonRequest(`http://x/api/restaurants${q}`, 'GET')));
      expect(res.status).toBe(200);
      expect((await jsonArray<{ id: string }>(res)).map((r) => r.id)).toEqual(['rest-own']);
    }
  });

  it('GET /api/restaurants/[id] es publico: da el del despliegue; el id de otra instancia da 404', async () => {
    const own = await getRestaurant(
      ctx(jsonRequest(`http://x/api/restaurants/rest-own?instance_id=${OTHER}`, 'GET'), { id: 'rest-own' }),
    );
    expect(own.status).toBe(200);
    expect((await jsonObject(own)).id).toBe('rest-own');

    // `rest-foreign` solo existe en OTHER: al buscar en la instancia del despliegue no aparece.
    const foreign = await getRestaurant(
      ctx(jsonRequest(`http://x/api/restaurants/rest-foreign?instance_id=${OTHER}`, 'GET'), { id: 'rest-foreign' }),
    );
    expect(foreign.status).toBe(404);
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

describe('compras, recetas y proveedores: el instance_id ajeno es 403', () => {
  it('GET con instancia ajena -> 403 (no 200 con datos propios)', async () => {
    await forbidden(await listSuppliers(ctx(jsonRequest(`http://x/api/suppliers?instance_id=${OTHER}`, 'GET'))));
    await forbidden(await listRecipes(ctx(jsonRequest(`http://x/api/recipes?instance_id=${OTHER}`, 'GET'))));
    await forbidden(await listPurchases(ctx(jsonRequest(`http://x/api/purchases?instance_id=${OTHER}`, 'GET'))));
  });

  it('GET con la instancia propia (o sin query) devuelve solo lo propio', async () => {
    const sup = await listSuppliers(ctx(jsonRequest(`http://x/api/suppliers?instance_id=${OWN}`, 'GET')));
    expect((await jsonArray<{ id: string }>(sup)).map((s) => s.id)).toEqual(['sup-own']);
    const rec = await listRecipes(ctx(jsonRequest('http://x/api/recipes', 'GET')));
    expect((await jsonArray<{ id: string }>(rec)).map((r) => r.id)).toEqual(['rec-own']);
    const pur = await listPurchases(ctx(jsonRequest('http://x/api/purchases', 'GET')));
    expect((await jsonArray<{ id: string }>(pur)).map((p) => p.id)).toEqual(['pur-own']);
  });

  it('POST con query o body ajenos -> 403 y no escribe en NINGUNA instancia', async () => {
    const supplier = { name: 'Intruso SA' };
    await forbidden(await createSupplier(ctx(jsonRequest(`http://x/api/suppliers?instance_id=${OTHER}`, 'POST', supplier))));
    await forbidden(await createSupplier(ctx(jsonRequest('http://x/api/suppliers', 'POST', { ...supplier, instance_id: OTHER }))));

    const recipe = {
      menuItemId: 'mi-own',
      name: 'Receta intrusa',
      yield: 1,
      lines: [{ inventoryItemId: 'inv-own', name: 'Harina', qty: 1, unit: 'kg', unitCost: 1 }],
    };
    await forbidden(await createRecipe(ctx(jsonRequest(`http://x/api/recipes?instance_id=${OTHER}`, 'POST', recipe))));
    await forbidden(await createRecipe(ctx(jsonRequest('http://x/api/recipes', 'POST', { ...recipe, instance_id: OTHER }))));

    const purchase = {
      supplierId: 'sup-own',
      invoiceNumber: 'F-9',
      invoiceDate: '2026-10-02',
      lines: [{ inventoryItemId: 'inv-own', name: 'Harina', qty: 1, unit: 'kg', unitCost: 1 }],
    };
    await forbidden(await createPurchase(ctx(jsonRequest(`http://x/api/purchases?instance_id=${OTHER}`, 'POST', purchase))));
    await forbidden(await createPurchase(ctx(jsonRequest('http://x/api/purchases', 'POST', { ...purchase, instance_id: OTHER }))));

    expect(await getMemoryAdapter().list('supplier', OWN)).toHaveLength(1);
    expect(await getMemoryAdapter().list('supplier', OTHER)).toHaveLength(1);
    expect(await getMemoryAdapter().list('recipe', OWN)).toHaveLength(1);
    expect(await getMemoryAdapter().list('recipe', OTHER)).toHaveLength(1);
    expect(await getMemoryAdapter().list('purchase', OWN)).toHaveLength(1);
    expect(await getMemoryAdapter().list('purchase', OTHER)).toHaveLength(1);
  });

  it('POST con la instancia de la sesion -> 201 y sin residuo en la otra', async () => {
    const res = await createSupplier(ctx(jsonRequest('http://x/api/suppliers', 'POST', { name: 'Panaderia', instance_id: OWN })));
    expect(res.status).toBe(201);
    expect((await jsonObject(res)).instance_id).toBe(OWN);
    expect(await getMemoryAdapter().list('supplier', OTHER)).toHaveLength(1);
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

  it('GET /api/menu-nutrition busca la carta en la instancia del despliegue (200, no 404, aunque el query pida otra)', async () => {
    // `propio` solo existe en la instancia OWN: si la ruta honrara el query, no encontraria el restaurante y
    // devolveria 404. Con el tenant del despliegue encuentra la carta y, sin GOS que consultar, responde 200.
    const res = await publicNutrition(
      apiContext({
        request: new Request(`http://x/api/menu-nutrition?slug=propio&instance_id=${OTHER}`),
        user: null,
        instanceId: OWN,
      }),
    );
    expect(res.status).toBe(200);
  });

  it('GET /api/restaurants sin sesion ni locals.instanceId sirve el despliegue aunque pidan otra instancia', async () => {
    const res = await listRestaurants(
      apiContext({ request: new Request(`http://x/api/restaurants?instance_id=${OTHER}`), user: null, omitInstanceId: true }),
    );
    expect(res.status).toBe(200);
    expect((await jsonArray<{ id: string }>(res)).map((r) => r.id)).toEqual(['rest-own']);
  });

  it('POST /api/orders de invitado sin locals.instanceId ignora el instance_id ajeno y crea en el despliegue', async () => {
    const req = jsonRequest(`http://x/api/orders?instance_id=${OTHER}`, 'POST', {
      tableId: 'tab-own',
      items: [{ menuItemId: 'mi-own', qty: 1 }],
      instance_id: OTHER,
    });
    const res = await createOrder(apiContext({ request: req, user: null, omitInstanceId: true }));
    expect(res.status).toBe(201);
    expect((await jsonObject(res)).instance_id).toBe(OWN);
    expect(await getMemoryAdapter().list('order', OTHER)).toHaveLength(1);
  });
});

describe('cuerpos de escritura: el instance_id tampoco elige datos', () => {
  // Una categoria propia y una ajena, para poder comprobar el PATCH de /api/categories/[id].
  beforeEach(async () => {
    await seed(OWN, 'category', 'cat-own', { name: 'Entradas propias' });
    await seed(OTHER, 'category', 'cat-foreign', { name: 'Entradas ajenas' });
  });

  const cases: Array<{
    title: string;
    handler: APIRoute;
    method: 'PATCH' | 'POST';
    url: string;
    params: Record<string, string>;
    body: Record<string, unknown>;
    entity: string;
    ownId: string;
    foreignId: string;
  }> = [
    { title: 'inventory PATCH', handler: patchInventory, method: 'PATCH', url: 'inventory/inv-own', params: { id: 'inv-own' }, body: { name: 'Cambio', instance_id: OTHER }, entity: 'inventoryItem', ownId: 'inv-own', foreignId: 'inv-foreign' },
    { title: 'categories PATCH', handler: patchCategory, method: 'PATCH', url: 'categories/cat-own', params: { id: 'cat-own' }, body: { name: 'Cambio', instance_id: OTHER }, entity: 'category', ownId: 'cat-own', foreignId: 'cat-foreign' },
    { title: 'menu-items PATCH', handler: patchMenuItem, method: 'PATCH', url: 'menu-items/mi-own', params: { id: 'mi-own' }, body: { name: 'Cambio', instance_id: OTHER }, entity: 'menuItem', ownId: 'mi-own', foreignId: 'mi-foreign' },
    { title: 'tables PATCH', handler: patchTable, method: 'PATCH', url: 'tables/tab-own', params: { id: 'tab-own' }, body: { capacity: 99, instance_id: OTHER }, entity: 'table', ownId: 'tab-own', foreignId: 'tab-foreign' },
    { title: 'orders PATCH', handler: patchOrder, method: 'PATCH', url: 'orders/ord-own', params: { id: 'ord-own' }, body: { note: 'Cambio', instance_id: OTHER }, entity: 'order', ownId: 'ord-own', foreignId: 'ord-foreign' },
    { title: 'restaurants PATCH', handler: patchRestaurant, method: 'PATCH', url: 'restaurants/rest-own', params: { id: 'rest-own' }, body: { name: 'Cambio', instance_id: OTHER }, entity: 'restaurant', ownId: 'rest-own', foreignId: 'rest-foreign' },
    { title: 'notifications PATCH', handler: patchNotification, method: 'PATCH', url: 'notifications/not-own', params: { id: 'not-own' }, body: { isRead: true, instance_id: OTHER }, entity: 'notification', ownId: 'not-own', foreignId: 'not-foreign' },
    { title: 'inventory transactions POST', handler: postTx, method: 'POST', url: 'inventory/inv-own/transactions', params: { id: 'inv-own' }, body: { kind: 'use', qty: 1, instance_id: OTHER }, entity: 'inventoryItem', ownId: 'inv-own', foreignId: 'inv-foreign' },
    { title: 'orders transition POST', handler: transitionOrder, method: 'POST', url: 'orders/ord-own/transition', params: { id: 'ord-own' }, body: { to: 'preparing', instance_id: OTHER }, entity: 'order', ownId: 'ord-own', foreignId: 'ord-foreign' },
  ];

  it.each(cases)('$title: instance_id ajeno en el body -> 403 sin tocar NINGUNA instancia', async (c: (typeof cases)[number]) => {
    const adapter = getMemoryAdapter();
    const beforeOwn = await adapter.get(c.entity, c.ownId, OWN);
    const beforeForeign = await adapter.get(c.entity, c.foreignId, OTHER);

    const res = await c.handler(ctx(jsonRequest(`http://x/api/${c.url}`, c.method, c.body), c.params));
    await forbidden(res);

    expect(await adapter.get(c.entity, c.ownId, OWN)).toEqual(beforeOwn);
    expect(await adapter.get(c.entity, c.foreignId, OTHER)).toEqual(beforeForeign);
  });

  it('un instance_id propio (= sesion) en el body no bloquea la escritura legitima', async () => {
    const res = await patchInventory(
      ctx(jsonRequest('http://x/api/inventory/inv-own', 'PATCH', { name: 'Cambio', instance_id: OWN }), { id: 'inv-own' }),
    );
    expect(res.status).toBe(200);
    expect((await jsonObject(res)).name).toBe('Cambio');
    expect((await getMemoryAdapter().get('inventoryItem', 'inv-foreign', OTHER))?.name).toBe('Harina ajena');
  });

  it('sin locals.instanceId el body ajeno sigue siendo 403 y no cambia nada', async () => {
    const res = await patchInventory(
      ctxNoLocals(jsonRequest('http://x/api/inventory/inv-own', 'PATCH', { name: 'Cambio', instance_id: OTHER }), { id: 'inv-own' }),
    );
    expect(res.status).toBe(403);
    expect((await getMemoryAdapter().get('inventoryItem', 'inv-own', OWN))?.name).toBe('Harina propia');
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
