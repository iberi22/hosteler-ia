// Resolver una sesion es UN get por id derivado del token, no listar y descifrar todas las sesiones.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createUser, createSession, resolveSession, destroySession, sessionIdFor, LEGACY_SESSION_SCAN_UNTIL } from './session';
import { getMemoryAdapter, type DomainRecord } from '../domain';

const I = 'default';

async function owner() {
  const a = getMemoryAdapter();
  const u = await createUser(a, I, { email: 'd@fize.app', name: 'D', password: 'password-123', role: 'owner' });
  return { a, u };
}

describe('busqueda de sesion por id derivado del token', () => {
  beforeEach(() => getMemoryAdapter().clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolver no lista las sesiones', async () => {
    const { a } = await owner();
    for (let i = 0; i < 5; i++) await createSession(a, I, 'otro');
    const token = await createSession(a, I, (await a.list('user', I))[0].id);
    const list = vi.spyOn(a, 'list');
    expect((await resolveSession(a, I, token))?.user.email).toBe('d@fize.app');
    expect(list).not.toHaveBeenCalledWith('session', I);
    expect(await a.get('session', await sessionIdFor(token), I)).not.toBeNull();
  });

  it('sesion antigua (id aleatorio) se encuentra una vez y se migra al id derivado', async () => {
    const { a, u } = await owner();
    const token = 'legacy-token-1';
    const now = new Date().toISOString();
    await a.create('session', { id: 'viejo-123', instance_id: I, token, userId: u.id, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), created_at: now, updated_at: now } as DomainRecord);
    expect((await resolveSession(a, I, token))?.user.id).toBe(u.id);
    expect(await a.get('session', 'viejo-123', I)).toBeNull();
    expect(await a.get('session', await sessionIdFor(token), I)).not.toBeNull();
    const list = vi.spyOn(a, 'list');
    expect((await resolveSession(a, I, token))?.user.id).toBe(u.id);
    expect(list).not.toHaveBeenCalledWith('session', I);
  });

  it('pasada la fecha de corte no se recorren sesiones antiguas', async () => {
    const { a } = await owner();
    vi.useFakeTimers({ now: LEGACY_SESSION_SCAN_UNTIL + 1 });
    const list = vi.spyOn(a, 'list');
    expect(await resolveSession(a, I, 'token-falso')).toBeNull();
    expect(list).not.toHaveBeenCalledWith('session', I);
  });

  it('una sesion vencida se borra al usarla', async () => {
    const { a, u } = await owner();
    const token = await createSession(a, I, u.id);
    const id = await sessionIdFor(token);
    await a.update('session', id, { expiresAt: new Date(Date.now() - 1000).toISOString() }, I);
    expect(await resolveSession(a, I, token)).toBeNull();
    expect(await a.get('session', id, I)).toBeNull();
  });

  it('cerrar sesion borra el registro del id derivado', async () => {
    const { a, u } = await owner();
    const token = await createSession(a, I, u.id);
    await destroySession(a, I, token);
    expect(await resolveSession(a, I, token)).toBeNull();
  });
});
