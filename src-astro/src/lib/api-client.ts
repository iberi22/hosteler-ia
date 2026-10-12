// api-client.ts — fetch throttle + 429 backoff + tier gate isProEnabled (H1.08)
// Svelte-friendly, sin deps, guarda window SSR, usa Xavier heartbeat tier
// Modo local (/local/*, docs/producto/NODO-LOCAL.md §2.2): las llamadas a /api/* no salen a la red, se
// despachan a los mismos handlers sobre IndexedDB (lib/local/localApi.ts, cargado solo en ese modo).
import { isLocalMode } from './local/localMode';

let lastCall = 0;
const MIN_INTERVAL_MS = 300; // throttle 429 prevention
let tier: 'free' | 'socio' | 'socio-managed' = 'free';

export function setTier(t: typeof tier) { tier = t; }
export function isProEnabled(): boolean { return tier !== 'free'; } // Pro = nodo SWAL activo, no Stripe
export function getTier() { return tier; }

async function throttle() {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

function isApiPath(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, typeof location !== 'undefined' ? location.origin : 'http://fize.local');
    return (typeof location === 'undefined' || url.origin === location.origin) && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}, retries = 3): Promise<Response> {
  if (isLocalMode() && isApiPath(input)) {
    // Sin throttle ni reintentos: no hay servidor que limite. Nunca cae a la red.
    const { localFetch } = await import('./local/localApi');
    return localFetch(input, init);
  }
  await throttle();
  // gate: free no puede inferencia IA costosa
  if (!isProEnabled() && String(input).includes('/api/ai/infer')) {
    throw new Error('402 Pro required — activate SWAL node');
  }
  let attempt = 0;
  while (true) {
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= retries) return res;
    // 429 backoff exponential + jitter
    const retryAfter = Number(res.headers.get('retry-after') ?? '0') * 1000;
    const backoff = retryAfter || Math.pow(2, attempt) * 500 + Math.random() * 200;
    await new Promise((r) => setTimeout(r, backoff));
    attempt++;
  }
}

export const api = {
  get: (url: string, init?: RequestInit) => apiFetch(url, { ...init, method: 'GET' }),
  post: (url: string, body?: unknown, init?: RequestInit) => apiFetch(url, { ...init, method: 'POST', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }),
  put: (url: string, body?: unknown, init?: RequestInit) => apiFetch(url, { ...init, method: 'PUT', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }),
  del: (url: string, init?: RequestInit) => apiFetch(url, { ...init, method: 'DELETE' }),
};
