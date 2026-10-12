import { describe, it, expect, beforeEach } from 'vitest';
import { GET as listTables, POST as createTable } from '../pages/api/tables/index';
import { GET as getTable, PATCH as updateTable, DELETE as deleteTable } from '../pages/api/tables/[id]';
import { GET as resolveQr } from '../pages/api/qr/[code]';
import { getMemoryAdapter } from './domain';

describe('Tables API Endpoints', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const mockUser = { id: 'test-user', email: 'test@fize.app', name: 'Tester', role: 'owner' };
  const mockContext = (req: Request, params: Record<string, string> = {}) => ({
    request: req,
    params,
    locals: { user: mockUser },
  }) as any;

  const tablePayload = (number = 5) => ({
    number,
    capacity: 4,
    restaurantId: 'rest-1',
  });

  const postTable = async (payload: unknown) => {
    const req = new Request('http://localhost/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return createTable(mockContext(req));
  };

  it('POST /api/tables - creates a table with auto-generated QR code', async () => {
    const res = await postTable(tablePayload());
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.number).toBe(5);
    expect(data.capacity).toBe(4);
    expect(data.qrCode).toBeDefined();
    expect(typeof data.qrCode).toBe('string');
    expect(data.instance_id).toBe('default');
  });

  it('POST /api/tables - fails validation when fields are missing', async () => {
    const res = await postTable({ number: 3 });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(data.details).toBeDefined();
  });

  it('POST /api/tables - generates unique QR codes', async () => {
    const r1 = await (await postTable(tablePayload(1))).json();
    const r2 = await (await postTable(tablePayload(2))).json();
    expect(r1.qrCode).not.toBe(r2.qrCode);
  });

  it('GET /api/tables - lists active tables', async () => {
    await postTable(tablePayload(7));
    const res = await listTables(mockContext(new Request('http://localhost/api/tables')));
    expect(res.status).toBe(200);

    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0].number).toBe(7);
  });

  it('GET /api/tables/[id] - retrieves table by ID, 404 when missing', async () => {
    const created = await (await postTable(tablePayload(9))).json();
    const res = await getTable(mockContext(new Request(`http://localhost/api/tables/${created.id}`), { id: created.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).number).toBe(9);

    const missing = await getTable(mockContext(new Request('http://localhost/api/tables/nope'), { id: 'nope' }));
    expect(missing.status).toBe(404);
  });

  it('PATCH /api/tables/[id] - updates capacity', async () => {
    const created = await (await postTable(tablePayload(11))).json();
    const req = new Request(`http://localhost/api/tables/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capacity: 8 }),
    });
    const res = await updateTable(mockContext(req, { id: created.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).capacity).toBe(8);
  });

  it('DELETE /api/tables/[id] - soft deletes (hidden from list)', async () => {
    const created = await (await postTable(tablePayload(12))).json();
    const del = await deleteTable(
      mockContext(new Request(`http://localhost/api/tables/${created.id}`, { method: 'DELETE' }), { id: created.id }),
    );
    expect(del.status).toBe(200);

    const list = await (await listTables(mockContext(new Request('http://localhost/api/tables')))).json();
    expect(list).toHaveLength(0);
  });

  it('GET /api/qr/[code] - resolves table + public payload', async () => {
    const created = await (await postTable(tablePayload(15))).json();
    const res = await resolveQr(
      mockContext(new Request(`http://localhost/api/qr/${created.qrCode}`), { code: created.qrCode }),
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.table.number).toBe(15);
    expect(data.table.qrCode).toBeUndefined();
    expect(data.menuItems).toEqual([]);
  });

  it('GET /api/qr/[code] - 404 for unknown code, no sensitive data leaked', async () => {
    const res = await resolveQr(mockContext(new Request('http://localhost/api/qr/unknown'), { code: 'unknown' }));
    expect(res.status).toBe(404);
  });
});
