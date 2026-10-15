import { describe, it, expect, beforeEach } from 'vitest';
import { GET as previewReset, POST as resetData } from '../pages/api/reset-data/index';
import { getMemoryAdapter } from './domain';
import type { SessionUser } from './auth/session';
import { apiContext } from './testing/apiContext';
import {
  canReset,
  resetDenial,
  planReset,
  executeReset,
  resolveRequestedEntities,
  RESETTABLE_ENTITIES,
  PROTECTED_ENTITIES,
} from './resetData';

const OWNER: SessionUser = { id: 'u-owner', email: 'owner@fize.app', name: 'Owner', role: 'owner' };
const STAFF: SessionUser = { id: 'u-staff', email: 'staff@fize.app', name: 'Staff', role: 'staff' };

const ctx = (req: Request, user: SessionUser | null = OWNER) =>
  apiContext({ request: req, params: {}, user, instanceId: 'default' });

const postReq = (body?: unknown) =>
  new Request('http://localhost/api/reset-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let seq = 0;
const seed = async (entity: string, over: Record<string, unknown> = {}) => {
  seq++;
  const timestamp = new Date().toISOString();
  return getMemoryAdapter().create(entity, {
    id: `${entity}-${seq}`,
    instance_id: 'default',
    created_at: timestamp,
    updated_at: timestamp,
    ...over,
  });
};

describe('reset-data — reglas puras', () => {
  // Sin esto, las filas del test anterior se quedan en el MemoryAdapter
  // singleton y el conteo del plan sale con lo que el test anterior dejo.
  beforeEach(() => {
    getMemoryAdapter().clear();
    seq = 0;
  });

  it('user y session nunca son reseteables', () => {
    for (const protectedEntity of PROTECTED_ENTITIES) {
      expect(RESETTABLE_ENTITIES as readonly string[]).not.toContain(protectedEntity);
    }
  });

  it('sin `entities` resetea todo lo reseteable', () => {
    const { known, unknown } = resolveRequestedEntities(undefined);
    expect(known).toEqual([...RESETTABLE_ENTITIES]);
    expect(unknown).toEqual([]);
  });

  it('pide user explicitamente y lo rechaza: no es un camino para borrar admins', () => {
    const { known, unknown } = resolveRequestedEntities(['order', 'user', 'session']);
    expect(known).toEqual(['order']);
    expect(unknown).toEqual(['user', 'session']);
  });

  it('una entidad desconocida va a skipped, no se ejecuta', () => {
    const { known, unknown } = resolveRequestedEntities(['order', 'nuclearCode']);
    expect(known).toEqual(['order']);
    expect(unknown).toEqual(['nuclearCode']);
  });

  it('solo owner puede resetear', () => {
    expect(canReset('owner')).toBe(true);
    expect(canReset('staff')).toBe(false);
    expect(canReset('admin')).toBe(false);
    expect(canReset(undefined)).toBe(false);
    expect(resetDenial('staff')).toBe('Owner role required to reset data');
    expect(resetDenial(null)).toBe('Authentication required');
  });

  it('el dry-run cuenta por entidad y no borra', async () => {
    const adapter = getMemoryAdapter();
    await seed('order', { status: 'paid' });
    await seed('order', { status: 'pending' });
    await seed('menuItem', { name: 'Cafe' });

    const plan = await planReset(adapter, 'default', ['order', 'menuItem']);
    expect(plan.rows).toEqual([
      { entity: 'order', count: 2 },
      { entity: 'menuItem', count: 1 },
    ]);
    expect(plan.totalInInstance).toBe(3);
    // Sigue todo en pie: un plan no toca nada.
    expect((await adapter.list('order', 'default'))).toHaveLength(2);
  });

  it('el plan cuenta lo del instance y executeReset no toca los de otros', async () => {
    const adapter = getMemoryAdapter();
    await seed('order', { status: 'paid' });
    await adapter.create('order', {
      id: 'order-ajeno',
      instance_id: 'otro-restaurante',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // `list` ya viene filtrado por instance: el plan solo ve lo suyo.
    const plan = await planReset(adapter, 'default', ['order']);
    expect(plan.rows).toEqual([{ entity: 'order', count: 1 }]);
    expect(plan.totalInInstance).toBe(1);

    const outcome = await executeReset(adapter, 'default', ['order'], []);
    expect(outcome.deleted).toBe(1);
    // El aviso ajeno sobrevive al reset de este local.
    expect((await adapter.list('order', 'otro-restaurante'))).toHaveLength(1);
    expect((await adapter.list('order', 'default'))).toHaveLength(0);
  });
});

describe('reset-data API', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    seq = 0;
  });

  it('sin sesion responde 401 y no borra nada', async () => {
    await seed('order');
    const res = await resetData(ctx(postReq({ confirm: true }), null));
    expect(res.status).toBe(401);

    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(1);
  });

  it('un staff recibe 403: puede cobrar pero no borrar el historial', async () => {
    await seed('order');
    const res = await resetData(ctx(postReq({ confirm: true }), STAFF));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Owner role required to reset data');
    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(1);
  });

  it('POST sin confirm es dry-run: informa y NO borra', async () => {
    await seed('order');
    await seed('order');

    const res = await resetData(ctx(postReq()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.totalInInstance).toBe(2);
    expect(body.rows.find((r: { entity: string }) => r.entity === 'order').count).toBe(2);
    expect(body.message).toContain('Re-send with { "confirm": true }');

    // Lo importante: el dry-run no destruyo nada.
    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(2);
  });

  it('POST con confirm borra los datos del instance', async () => {
    await seed('order', { status: 'paid' });
    await seed('menuItem', { name: 'Cafe' });

    const res = await resetData(ctx(postReq({ confirm: true })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(false);
    expect(body.deleted).toBe(2);
    expect(body.message).toContain('Users and sessions were kept');

    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(0);
    expect((await getMemoryAdapter().list('menuItem', 'default'))).toHaveLength(0);
  });

  // La regla que hace que esto no sea un suicide operacional: si el reset
  // borrara la sesion que lo autoriza, el owner se quedaria sin panel.
  it('confirm NO borra users ni sessions: el owner sigue pudiendo entrar', async () => {
    await seed('user', { email: 'owner@fize.app', role: 'owner' });
    await seed('session', { userId: 'u-owner', token: 'tok' });
    await seed('order');

    await resetData(ctx(postReq({ confirm: true })));

    expect((await getMemoryAdapter().list('user', 'default'))).toHaveLength(1);
    expect((await getMemoryAdapter().list('session', 'default'))).toHaveLength(1);
    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(0);
  });

  it('solo borra las entidades pedidas', async () => {
    await seed('order');
    await seed('menuItem', { name: 'Cafe' });

    const res = await resetData(ctx(postReq({ confirm: true, entities: ['menuItem'] })));
    const body = await res.json();
    expect(body.deleted).toBe(1);
    expect(body.skipped).toEqual([]);

    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(1);
    expect((await getMemoryAdapter().list('menuItem', 'default'))).toHaveLength(0);
  });

  it('un instance_id ajeno en el body se rechaza con 403 y no borra nada', async () => {
    await seed('order');
    await getMemoryAdapter().create('order', {
      id: 'order-ajeno',
      instance_id: 'otro-restaurante',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const res = await resetData(ctx(postReq({ confirm: true, instance_id: 'otro-restaurante' })));
    // El instance sale de locals (la sesion): pedir otro es 403, no se borra ni lo ajeno ni lo propio.
    expect(res.status).toBe(403);
    expect((await getMemoryAdapter().list('order', 'otro-restaurante'))).toHaveLength(1);
    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(1);
  });

  it('pedir solo entidades protegidas responde 400 y no borra', async () => {
    await seed('order');
    const res = await resetData(ctx(postReq({ confirm: true, entities: ['user'] })));
    expect(res.status).toBe(400);
    expect((await res.json()).skipped).toEqual(['user']);
    expect((await getMemoryAdapter().list('order', 'default'))).toHaveLength(1);
  });

  it('GET es el dry-run y tambien exige owner', async () => {
    await seed('order');
    const res = await previewReset(ctx(new Request('http://localhost/api/reset-data')));
    expect(res.status).toBe(200);
    expect((await res.json()).dryRun).toBe(true);

    const asStaff = await previewReset(ctx(new Request('http://localhost/api/reset-data'), STAFF));
    expect(asStaff.status).toBe(403);

    const anon = await previewReset(ctx(new Request('http://localhost/api/reset-data'), null));
    expect(anon.status).toBe(401);
  });

  it('400 con un body que no es JSON', async () => {
    const req = new Request('http://localhost/api/reset-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ no soy json',
    });
    const res = await resetData(ctx(req));
    expect(res.status).toBe(400);
  });
});