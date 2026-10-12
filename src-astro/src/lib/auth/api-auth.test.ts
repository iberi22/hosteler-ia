import { describe, it, expect, beforeEach } from 'vitest';
import { POST as register } from '../../pages/api/auth/register';
import { POST as login } from '../../pages/api/auth/login';
import { GET as me } from '../../pages/api/auth/me';
import { POST as logout } from '../../pages/api/auth/logout';
import { getMemoryAdapter } from '../domain';
import { domainConfig } from '../domain.config';

describe('auth API flow', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const jar: Record<string, string> = {};

  const cookies = () => ({
    get: (name: string) => (jar[name] ? { value: jar[name] } : undefined),
    set: (name: string, value: string) => {
      jar[name] = value;
    },
    delete: (name: string) => {
      delete jar[name];
    },
  });

  const ctx = (req: Request) => ({ request: req, cookies: cookies(), locals: {} }) as any;

  const postJson = (url: string, payload: unknown) =>
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  it('register → me → logout → login roundtrip', async () => {
    for (const k of Object.keys(jar)) delete jar[k];

    const regRes = await register(ctx(postJson('http://localhost/api/auth/register', {
      email: 'owner@fize.app',
      password: 'password-123',
      name: 'Owner',
    })));
    expect(regRes.status).toBe(201);
    const reg = await regRes.json();
    expect(reg.user.role).toBe('owner');
    expect(jar.fize_session).toBeDefined();

    const meRes = await me(ctx(new Request('http://localhost/api/auth/me')));
    expect(meRes.status).toBe(200);
    const session = await meRes.json();
    expect(session.user.email).toBe('owner@fize.app');
    expect(session.profile.role).toBe('owner');

    const outRes = await logout(ctx(new Request('http://localhost/api/auth/logout', { method: 'POST' })));
    expect(outRes.status).toBe(200);
    expect(jar.fize_session).toBeUndefined();

    const meAfter = await me(ctx(new Request('http://localhost/api/auth/me')));
    expect((await meAfter.json()).user).toBeNull();

    const loginRes = await login(ctx(postJson('http://localhost/api/auth/login', {
      email: 'owner@fize.app',
      password: 'password-123',
    })));
    expect(loginRes.status).toBe(200);
    expect(jar.fize_session).toBeDefined();
  });

  it('rejects duplicates, bad credentials and weak passwords', async () => {
    const payload = { email: 'dup@fize.app', password: 'password-123', name: 'Dup' };
    expect((await register(ctx(postJson('http://localhost/api/auth/register', payload)))).status).toBe(201);
    expect((await register(ctx(postJson('http://localhost/api/auth/register', payload)))).status).toBe(409);

    const badPass = await login(ctx(postJson('http://localhost/api/auth/login', {
      email: 'dup@fize.app',
      password: 'wrong',
    })));
    expect(badPass.status).toBe(401);

    const weak = await register(ctx(postJson('http://localhost/api/auth/register', {
      email: 'w@fize.app',
      password: 'short',
      name: 'W',
    })));
    expect(weak.status).toBe(400);
  });

  it('registro cerrado: solo el primer usuario (dueno) o un dueno con sesion pueden dar de alta', async () => {
    const jarOf = () => {
      const j: Record<string, string> = {};
      return {
        j,
        c: (req: Request) => ({
          request: req,
          locals: {},
          cookies: {
            get: (n: string) => (j[n] ? { value: j[n] } : undefined),
            set: (n: string, v: string) => { j[n] = v; },
            delete: (n: string) => { delete j[n]; },
          },
        }) as any,
      };
    };
    const reg = (c: ReturnType<typeof jarOf>, email: string) =>
      register(c.c(postJson('http://localhost/api/auth/register', { email, password: 'password-123', name: email })));

    const owner = jarOf();
    const ownerRes = await reg(owner, 'owner@fize.app');
    expect(ownerRes.status).toBe(201);
    expect((await ownerRes.json()).user.role).toBe('owner');
    const ownerToken = owner.j.fize_session;
    expect(ownerToken).toBeTruthy();

    // Un desconocido sin sesion ya no entra como staff del restaurante.
    expect((await reg(jarOf(), 'intruso@fize.app')).status).toBe(403);

    // El dueno da de alta a su personal; su propia sesion no cambia.
    const staffRes = await reg(owner, 'mesero@fize.app');
    expect(staffRes.status).toBe(201);
    expect((await staffRes.json()).user.role).toBe('staff');
    expect(owner.j.fize_session).toBe(ownerToken);

    // Un staff con sesion no puede invitar.
    const staff = jarOf();
    expect((await login(staff.c(postJson('http://localhost/api/auth/login', { email: 'mesero@fize.app', password: 'password-123' })))).status).toBe(200);
    expect((await reg(staff, 'otro@fize.app')).status).toBe(403);
  });

  it('register ignora ?instance_id= y usa la instancia del despliegue', async () => {
    const jarOf = () => {
      const j: Record<string, string> = {};
      return {
        c: (req: Request) =>
          ({
            request: req,
            locals: {},
            cookies: {
              get: (n: string) => (j[n] ? { value: j[n] } : undefined),
              set: (n: string, v: string) => { j[n] = v; },
              delete: (n: string) => { delete j[n]; },
            },
          }) as unknown as Parameters<typeof register>[0],
      };
    };
    const adapter = getMemoryAdapter();
    const url = 'http://localhost/api/auth/register?instance_id=other';

    // Instancia vacia: el dueno se crea en la del despliegue, no en `other`.
    const first = await register(jarOf().c(postJson(url, { email: 'a@fize.app', password: 'password-123', name: 'A' })));
    expect(first.status).toBe(201);
    expect((await adapter.list('user', domainConfig.instanceId)).length).toBe(1);
    expect((await adapter.list('user', 'other')).length).toBe(0);

    // Con dueno ya existente, apuntar a otra instancia no abre un segundo alta.
    const second = await register(jarOf().c(postJson(url, { email: 'b@fize.app', password: 'password-123', name: 'B' })));
    expect(second.status).toBe(403);
    expect((await adapter.list('user', 'other')).length).toBe(0);

    // Login tambien: un usuario de la instancia del despliegue entra aunque se pida otra.
    const ok = await login(jarOf().c(postJson('http://localhost/api/auth/login?instance_id=other', { email: 'a@fize.app', password: 'password-123' })));
    expect(ok.status).toBe(200);
  });
});
