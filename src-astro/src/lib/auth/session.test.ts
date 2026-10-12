import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  findUserByEmail,
  createUser,
  createSession,
  resolveSession,
  destroySession,
  SESSION_COOKIE,
  sessionCookieHeader,
  expiredSessionCookieHeader,
} from './session';
import { getMemoryAdapter } from '../domain';

describe('session auth core', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  it('hashes and verifies passwords (wrong password fails)', async () => {
    const hash = await hashPassword('secreto-123');
    expect(hash).toContain('$');
    expect(await verifyPassword('secreto-123', hash)).toBe(true);
    expect(await verifyPassword('otro', hash)).toBe(false);
    expect(await verifyPassword('x', 'basura')).toBe(false);
  });

  it('finds users by email case-insensitively', async () => {
    const adapter = getMemoryAdapter();
    await createUser(adapter, 'default', { email: 'Ana@Fize.app', name: 'Ana', password: 'password-1' });
    expect(await findUserByEmail(adapter, 'default', 'ana@fize.app')).not.toBeNull();
    expect(await findUserByEmail(adapter, 'default', 'nadie@fize.app')).toBeNull();
    expect(await findUserByEmail(adapter, 'other', 'ana@fize.app')).toBeNull();
  });

  it('session lifecycle: create → resolve → destroy', async () => {
    const adapter = getMemoryAdapter();
    const user = await createUser(adapter, 'default', { email: 'u@fize.app', name: 'U', password: 'password-1' });

    const token = await createSession(adapter, 'default', user.id);
    const resolved = await resolveSession(adapter, 'default', token);
    expect(resolved?.user.email).toBe('u@fize.app');

    expect(await resolveSession(adapter, 'default', 'bad-token')).toBeNull();
    expect(await resolveSession(adapter, 'default', undefined)).toBeNull();

    await destroySession(adapter, 'default', token);
    expect(await resolveSession(adapter, 'default', token)).toBeNull();
  });

  it('expired sessions do not resolve', async () => {
    const adapter = getMemoryAdapter();
    const user = await createUser(adapter, 'default', { email: 'e@fize.app', name: 'E', password: 'password-1' });
    const past = new Date(Date.now() - 1000).toISOString();
    await adapter.create('session', {
      id: 's1',
      instance_id: 'default',
      token: 'old-token',
      userId: user.id,
      expiresAt: past,
      created_at: past,
      updated_at: past,
    } as any);
    expect(await resolveSession(adapter, 'default', 'old-token')).toBeNull();
  });

  it('cookie headers carry session name and HttpOnly', () => {
    expect(sessionCookieHeader('abc')).toContain(`${SESSION_COOKIE}=abc`);
    expect(sessionCookieHeader('abc')).toContain('HttpOnly');
    expect(expiredSessionCookieHeader()).toContain('Max-Age=0');
  });
});
