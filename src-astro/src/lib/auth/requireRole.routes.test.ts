import { describe, it, expect, beforeEach } from 'vitest';
import { getMemoryAdapter } from '../domain';
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
  { name: 'orders/[id]/transition POST', mod: ordersTransition, method: 'POST', allowed: ['owner', 'staff', 'cocina'] },
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
