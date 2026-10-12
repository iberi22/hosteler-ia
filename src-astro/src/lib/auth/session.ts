// session.ts — auth propia Fi'ze (NO Lucia: deprecada upstream).
// Sesiones opacas en StorageAdapter (KV SESSION en prod vía vault adapter,
// Memory en tests). Passwords con PBKDF2-SHA256 vía WebCrypto (sin deps).
// Cookie: fize_session, HttpOnly, SameSite=Lax, 30 días.

import type { StorageAdapter, DomainRecord } from '../domain';

export const SESSION_COOKIE = 'fize_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [iterStr, saltHex, hashHex] = stored.split('$');
    const iterations = Number(iterStr);
    if (!iterations || !saltHex || !hashHex) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex) as BufferSource, iterations },
      key,
      256,
    );
    return bytesToHex(new Uint8Array(bits)) === hashHex;
  } catch {
    return false;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function findUserByEmail(
  adapter: StorageAdapter,
  instanceId: string,
  email: string,
): Promise<DomainRecord | null> {
  const users = await adapter.list('user', instanceId);
  const lower = email.toLowerCase();
  return (
    (users.find(
      (u) => String((u as Record<string, unknown>).email ?? '').toLowerCase() === lower,
    ) as DomainRecord | undefined) ?? null
  );
}

export async function createUser(
  adapter: StorageAdapter,
  instanceId: string,
  input: { email: string; name: string; password: string; role?: string },
): Promise<DomainRecord> {
  const now = new Date().toISOString();
  return adapter.create('user', {
    id: genId(),
    instance_id: instanceId,
    email: input.email.toLowerCase(),
    name: input.name,
    role: input.role ?? 'staff',
    passwordHash: await hashPassword(input.password),
    created_at: now,
    updated_at: now,
  } as DomainRecord);
}

// La sesion se guarda con un id derivado del token: resolverla es UN `get` (una lectura de R2), no listar y
// descifrar todas las sesiones de la instancia en cada peticion (antes: N lecturas por peticion; 59 en
// produccion el 2026-10-02 y creciendo, porque las vencidas nunca se borraban).
export async function sessionIdFor(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return 's_' + [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Sesiones creadas antes del id derivado (id aleatorio) solo se buscan recorriendo la lista. Duran 30 dias:
// pasada esta fecha ya no puede quedar ninguna valida y se deja de recorrer (un token falso no debe
// costar N lecturas).
export const LEGACY_SESSION_SCAN_UNTIL = Date.parse('2026-11-04T00:00:00Z');

export async function createSession(adapter: StorageAdapter, instanceId: string, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  await adapter.create('session', {
    id: await sessionIdFor(token),
    instance_id: instanceId,
    token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    created_at: now,
    updated_at: now,
  } as DomainRecord);
  return token;
}

export async function resolveSession(
  adapter: StorageAdapter,
  instanceId: string,
  token: string | undefined,
): Promise<{ user: SessionUser } | null> {
  if (!token) return null;
  const session = await findSession(adapter, instanceId, token);
  if (!session) return null;
  if (new Date(String(session.expiresAt)).getTime() < Date.now()) {
    await adapter.del('session', String(session.id), instanceId).catch(() => {});
    return null;
  }
  const user = (await adapter.get('user', String(session.userId), instanceId)) as Record<string, unknown> | null;
  if (!user || user.deleted_at) return null;
  return {
    user: {
      id: String(user.id),
      email: String(user.email),
      name: String(user.name ?? ''),
      role: String(user.role ?? 'staff'),
    },
  };
}

export async function destroySession(adapter: StorageAdapter, instanceId: string, token: string): Promise<void> {
  const session = await findSession(adapter, instanceId, token);
  if (session) {
    await adapter.del('session', String(session.id), instanceId);
  }
}

async function findSession(
  adapter: StorageAdapter,
  instanceId: string,
  token: string,
): Promise<Record<string, unknown> | null> {
  const direct = (await adapter.get('session', await sessionIdFor(token), instanceId)) as Record<string, unknown> | null;
  if (direct) return direct.token === token ? direct : null;
  if (Date.now() >= LEGACY_SESSION_SCAN_UNTIL) return null;
  const legacy = (await adapter.list('session', instanceId)).find((s) => (s as Record<string, unknown>).token === token) as
    | Record<string, unknown>
    | undefined;
  if (!legacy) return null;
  // Migracion: la misma sesion (mismo token y vencimiento) pasa al id derivado y se borra la vieja.
  const migrated = { ...legacy, id: await sessionIdFor(token), updated_at: new Date().toISOString() } as DomainRecord;
  try {
    await adapter.create('session', migrated);
    await adapter.del('session', String(legacy.id), instanceId);
    return migrated as unknown as Record<string, unknown>;
  } catch {
    return legacy;
  }
}

export class AuthError extends Error {
  public status: number;
  constructor(message = 'Authentication required', status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export function requireSession(locals: Record<string, unknown> | App.Locals | undefined): SessionUser {
  const user = (locals as App.Locals | undefined)?.user;
  if (!user) {
    throw new AuthError('Authentication required', 401);
  }
  return user;
}

export function isSecureRequest(request?: Request): boolean {
  if (import.meta.env.PROD) return true;
  if (!request) return false;
  try {
    const url = new URL(request.url);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSessionCookieOptions(request?: Request) {
  const isSecure = isSecureRequest(request);
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure: isSecure, // Secure flag in production/HTTPS
  };
}

export function sessionCookieHeader(token: string, secure = false): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secureFlag = secure ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

export function expiredSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
