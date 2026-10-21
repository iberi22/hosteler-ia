import { describe, it, expect, beforeEach } from 'vitest';
import { getMemoryAdapter } from '../domain';
import { tenantOf } from './tenant';
import * as inventoryIndex from '../../pages/api/inventory/index';
import * as inventoryId from '../../pages/api/inventory/[id]';
import * as inventoryTx from '../../pages/api/inventory/[id]/transactions';
import * as ordersId from '../../pages/api/orders/[id]';
import * as ordersPayment from '../../pages/api/orders/[id]/payment';
import * as ordersTransition from '../../pages/api/orders/[id]/transition';
import * as purchases from '../../pages/api/purchases/index';
import * as recipes from '../../pages/api/recipes/index';
import * as suppliers from '../../pages/api/suppliers/index';
import * as tablesId from '../../pages/api/tables/[id]';
import * as tablesIndex from '../../pages/api/tables/index';

// Matriz de permisos v1 (docs/producto/ALCANCE.md §6.2): owner, caja, staff, cocina.
const ROLES = ['owner', 'caja', 'staff', 'cocina'] as const;
type Role = (typeof ROLES)[number];

type Mod = Record<string, unknown>;
interface Case {
  name: string;
  mod: Mod;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  allowed: Role[];
}

const ALL: Role[] = ['owner', 'caja', 'staff', 'cocina'];
const OWNER: Role[] = ['owner'];
const FLOOR: Role[] = ['owner', 'caja', 'staff'];
const CASES: Case[] = [
  { name: 'inventory GET', mod: inventoryIndex, method: 'GET', allowed: ['owner', 'caja', 'cocina'] },
  { name: 'inventory POST', mod: inventoryIndex, method: 'POST', allowed: OWNER },
  { name: 'inventory/[id] GET', mod: inventoryId, method: 'GET', allowed: ['owner', 'caja', 'cocina'] },
  { name: 'inventory/[id] PATCH', mod: inventoryId, method: 'PATCH', allowed: OWNER },
  { name: 'inventory/[id] DELETE', mod: inventoryId, method: 'DELETE', allowed: OWNER },
  { name: 'inventory/[id]/transactions GET', mod: inventoryTx, method: 'GET', allowed: ['owner', 'caja', 'cocina'] },
  { name: 'inventory/[id]/transactions POST', mod: inventoryTx, method: 'POST', allowed: OWNER },
  { name: 'orders/[id] GET', mod: ordersId, method: 'GET', allowed: ALL },
  { name: 'orders/[id] PATCH', mod: ordersId, method: 'PATCH', allowed: FLOOR },
  { name: 'orders/[id] DELETE', mod: ordersId, method: 'DELETE', allowed: OWNER },
  { name: 'orders/[id]/payment POST', mod: ordersPayment, method: 'POST', allowed: ['owner', 'caja'] },
  { name: 'orders/[id]/payment GET', mod: ordersPayment, method: 'GET', allowed: ['owner', 'caja'] },
  { name: 'orders/[id]/transition POST', mod: ordersTransition, method: 'POST', allowed: ['owner', 'caja', 'staff', 'cocina'] },
  { name: 'purchases GET', mod: purchases, method: 'GET', allowed: OWNER },
  { name: 'purchases POST', mod: purchases, method: 'POST', allowed: OWNER },
  { name: 'recipes GET', mod: recipes, method: 'GET', allowed: ['owner', 'cocina'] },
  { name: 'recipes POST', mod: recipes, method: 'POST', allowed: OWNER },
  { name: 'suppliers GET', mod: suppliers, method: 'GET', allowed: OWNER },
  { name: 'suppliers POST', mod: suppliers, method: 'POST', allowed: OWNER },
  { name: 'tables GET', mod: tablesIndex, method: 'GET', allowed: ALL },
  { name: 'tables POST', mod: tablesIndex, method: 'POST', allowed: FLOOR },
  { name: 'tables/[id] GET', mod: tablesId, method: 'GET', allowed: ALL },
  { name: 'tables/[id] PATCH', mod: tablesId, method: 'PATCH', allowed: FLOOR },
  { name: 'tables/[id] DELETE', mod: tablesId, method: 'DELETE', allowed: FLOOR },
];

async function call(c: Case, role: Role | null): Promise<number> {
  const handler = c.mod[c.method] as (ctx: unknown) => Promise<Response>;
  const hasBody = c.method !== 'GET' && c.method !== 'DELETE';
  const request = new Request('http://localhost/api/x', {
    method: c.method,
    headers: { 'Content-Type': 'application/json' },
    body: hasBody ? '{}' : undefined,
  });
  const locals = role ? { user: { id: 'u-1', email: 'u@fize.app', name: 'U', role } } : {};
  const res = await handler({ request, params: { id: 'missing' }, locals } as never);
  return res.status;
}

describe('staff roles enforced on private API routes', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  for (const c of CASES) {
    it(`${c.name}: anonymous gets 401`, async () => {
      expect(await call(c, null)).toBe(401);
    });
    for (const role of ROLES) {
      const allowed = c.allowed.includes(role);
      it(`${c.name}: ${role} ${allowed ? 'is allowed' : 'gets 403'}`, async () => {
        const status = await call(c, role);
        if (allowed) {
          expect(status).not.toBe(403);
          expect(status).not.toBe(401);
        } else {
          expect(status).toBe(403);
        }
      });
    }
  }
});

// transition: el rol depende del estado destino (ALCANCE §6.2).
const TRANSITIONS: Array<{ from: string; to: string; allowed: Role[] }> = [
  { from: 'pending', to: 'preparing', allowed: ['owner', 'staff', 'cocina'] },
  { from: 'preparing', to: 'ready', allowed: ['owner', 'staff', 'cocina'] },
  { from: 'ready', to: 'served', allowed: ['owner', 'staff'] },
  { from: 'pending', to: 'cancelled', allowed: ['owner', 'caja', 'staff'] },
  { from: 'served', to: 'paid', allowed: ['owner', 'caja'] },
];

async function transition(role: Role | null, id: string, to: string): Promise<number> {
  const request = new Request('http://localhost/api/orders/x/transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to }),
  });
  const locals = role ? { user: { id: 'u-1', email: 'u@fize.app', name: 'U', role } } : {};
  const res = await (ordersTransition.POST as (ctx: unknown) => Promise<Response>)({
    request,
    params: { id },
    locals,
  } as never);
  return res.status;
}

describe('orders/[id]/transition: role by target state', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });
  for (const t of TRANSITIONS) {
    for (const role of ROLES) {
      const ok = t.allowed.includes(role);
      it(`${t.from}->${t.to}: ${role} ${ok ? 'gets 200' : 'gets 403'}`, async () => {
        const now = new Date().toISOString();
        await getMemoryAdapter().create('order', {
          id: 'o-1',
          instance_id: tenantOf({}),
          status: t.from,
          items: [],
          created_at: now,
          updated_at: now,
        } as never);
        expect(await transition(role, 'o-1', t.to)).toBe(ok ? 200 : 403);
      });
    }
  }
  it('anonymous gets 401', async () => {
    expect(await transition(null, 'o-1', 'preparing')).toBe(401);
  });
  it('unknown role gets 403 before the body is read', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'not json' });
    const res = await (ordersTransition.POST as (ctx: unknown) => Promise<Response>)({
      request,
      params: { id: 'o-1' },
      locals: { user: { id: 'u', email: 'u@x', name: 'U', role: 'guest' } },
    } as never);
    expect(res.status).toBe(403);
  });
});

// 'Ver costos' es solo del owner: ni recetas ni inventario filtran costos a otros roles.
const COST_KEYS = ['unitCost', 'costPerServing', 'costTotal', 'margin', 'lossMaking', 'lineTotal'];
async function getJson(mod: Mod, role: Role, params: Record<string, string> = {}): Promise<unknown> {
  const res = await (mod.GET as (ctx: unknown) => Promise<Response>)({
    request: new Request('http://localhost/api/x'),
    params,
    locals: { user: { id: 'u-1', email: 'u@fize.app', name: 'U', role } },
  } as never);
  expect(res.status).toBe(200);
  return res.json();
}

describe('cost fields are owner-only in GET responses', () => {
  beforeEach(async () => {
    getMemoryAdapter().clear();
    const now = new Date().toISOString();
    const inst = tenantOf({});
    const m = getMemoryAdapter();
    await m.create('menuItem', { id: 'm-1', instance_id: inst, name: 'Sopa', price: 20000, created_at: now, updated_at: now } as never);
    await m.create('inventoryItem', { id: 'i-1', instance_id: inst, name: 'Papa', unit: 'kg', stock: 1, unitCost: 1000, created_at: now, updated_at: now } as never);
    await m.create('recipe', {
      id: 'r-1', instance_id: inst, menuItemId: 'm-1', name: 'Sopa', yield: 1, costTotal: 2000, costPerServing: 2000,
      lines: [{ inventoryItemId: 'i-1', name: 'Papa', qty: 2, unit: 'kg', unitCost: 1000, lineTotal: 2000 }],
      created_at: now, updated_at: now,
    } as never);
    await m.create('inventoryTx', { id: 't-1', instance_id: inst, inventoryId: 'i-1', kind: 'purchase', qty: 1, unitCost: 1000, created_at: now, updated_at: now } as never);
  });
  const targets: Array<[string, Mod, Record<string, string>, Role[]]> = [
    ['recipes', recipes, {}, ['cocina']],
    ['inventory', inventoryIndex, {}, ['caja', 'cocina']],
    ['inventory/[id]', inventoryId, { id: 'i-1' }, ['caja', 'cocina']],
    ['inventory/[id]/transactions', inventoryTx, { id: 'i-1' }, ['caja', 'cocina']],
  ];
  for (const [name, mod, params, others] of targets) {
    for (const role of others) {
      it(`${name}: ${role} gets no cost fields`, async () => {
        const text = JSON.stringify(await getJson(mod, role, params));
        for (const k of COST_KEYS) expect(text).not.toContain(`"${k}"`);
      });
    }
  }
  it('owner still sees costs', async () => {
    expect(JSON.stringify(await getJson(recipes, 'owner'))).toContain('"costPerServing"');
    expect(JSON.stringify(await getJson(recipes, 'owner'))).toContain('"lineTotal"');
    expect(JSON.stringify(await getJson(inventoryIndex, 'owner'))).toContain('"unitCost"');
    expect(JSON.stringify(await getJson(inventoryId, 'owner', { id: 'i-1' }))).toContain('"unitCost"');
  });
});
