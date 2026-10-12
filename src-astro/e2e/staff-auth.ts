import { expect, type APIRequestContext } from '@playwright/test';

// Returns a `Cookie` header value carrying an owner `fize_session`. Staff write
// endpoints (menu/tables/inventory/...) require a session since SEC-01; public
// reads and customer order intake stay open.
//
// Registration is closed (only the first user of an instance, the owner, can
// self-register), so every spec shares ONE fixed owner: log in if it exists,
// register it on an empty instance otherwise. A successful login never trips the
// login rate limiter (it only counts failures).
const OWNER = { email: 'e2e-owner@fize.test', password: 'e2e-Password-123', name: 'E2E Owner' };

function sessionFrom(setCookie: string | undefined): string | null {
  return (setCookie ?? '').match(/fize_session=[^;]+/)?.[0] ?? null;
}

export async function staffCookie(request: APIRequestContext): Promise<string> {
  const login = await request.post('/api/auth/login', { data: { email: OWNER.email, password: OWNER.password } });
  if (login.status() === 200) {
    const cookie = sessionFrom(login.headers()['set-cookie']);
    if (cookie) return cookie;
  }
  const res = await request.post('/api/auth/register', { data: OWNER });
  if (res.status() === 403) {
    throw new Error('registration closed and the E2E owner does not exist: the local instance already has another owner (reset the local state, e.g. .wrangler/state)');
  }
  expect(res.status()).toBe(201);
  const cookie = sessionFrom(res.headers()['set-cookie']);
  if (!cookie) throw new Error('register did not set fize_session cookie');
  return cookie;
}

// Spread into request options: request.post(url, { ...auth(cookie), data })
export function authHeaders(cookie: string): { headers: Record<string, string> } {
  return { headers: { Cookie: cookie } };
}
