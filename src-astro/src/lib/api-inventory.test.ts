import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listItems, POST as createItem } from '../pages/api/inventory/index';
import { GET as getItem, PATCH as updateItem, DELETE as deleteItem } from '../pages/api/inventory/[id]';
import { GET as listTx, POST as postTx } from '../pages/api/inventory/[id]/transactions';
import { getMemoryAdapter } from './domain';

describe('Inventory API Endpoints', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const mockContext = (req: Request, params: Record<string, string> = {}) => ({
    request: req,
    params,
    locals: { user: mockUser },
  }) as any;

  const postJson = (url: string, method: string, payload: unknown, params: Record<string, string> = {}) => {
    const req = new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { req, params };
  };

  const createFlour = async (extra: Record<string, unknown> = {}) => {
    const { req } = postJson('http://localhost/api/inventory', 'POST', {
      name: 'Harina',
      unit: 'kg',
      initialStock: 20,
      minStock: 5,
      ...extra,
    });
    const res = await createItem(mockContext(req));
    expect(res.status).toBe(201);
    return res.json();
  };

  it('POST /api/inventory - creates item with initial purchase tx', async () => {
    const item = await createFlour();
    expect(item.stock).toBe(20);
    expect(item.unit).toBe('kg');

    const history = await listTx(
      mockContext(new Request(`http://localhost/api/inventory/${item.id}/transactions`), { id: item.id }),
    );
    expect(history.status).toBe(200);
    expect(((await history.json()) as unknown[])).toHaveLength(1);
  });

  it('POST transactions - use/waste reduce stock, history grows', async () => {
    const item = await createFlour();

    const use = postJson(`http://localhost/api/inventory/${item.id}/transactions`, 'POST', {
      kind: 'use',
      qty: 7,
      note: 'pan del día',
    });
    const useRes = await postTx(mockContext(use.req, { id: item.id }));
    expect(useRes.status).toBe(201);
    expect((await useRes.json()).item.stock).toBe(13);

    const bad = postJson(`http://localhost/api/inventory/${item.id}/transactions`, 'POST', {
      kind: 'sell',
      qty: 1,
    });
    const badRes = await postTx(mockContext(bad.req, { id: item.id }));
    expect(badRes.status).toBe(400);
  });

  it('GET /api/inventory?lowStock= - filters items below threshold', async () => {
    await createFlour();
    await createFlour({ name: 'Azúcar', initialStock: 2 });

    const res = await listItems(mockContext(new Request('http://localhost/api/inventory?lowStock=5')));
    const list = (await res.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Azúcar');
  });

  it('PATCH rejects direct stock edits (409), DELETE soft deletes', async () => {
    const item = await createFlour();

    const hack = postJson(`http://localhost/api/inventory/${item.id}`, 'PATCH', { stock: 999 });
    expect((await updateItem(mockContext(hack.req, { id: item.id }))).status).toBe(409);

    const rename = postJson(`http://localhost/api/inventory/${item.id}`, 'PATCH', { name: 'Harina integral' });
    const renamed = await updateItem(mockContext(rename.req, { id: item.id }));
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).name).toBe('Harina integral');

    const del = await deleteItem(
      mockContext(new Request(`http://localhost/api/inventory/${item.id}`, { method: 'DELETE' }), { id: item.id }),
    );
    expect(del.status).toBe(200);

    const gone = await getItem(
      mockContext(new Request(`http://localhost/api/inventory/${item.id}`), { id: item.id }),
    );
    expect(gone.status).toBe(404);
  });
});
