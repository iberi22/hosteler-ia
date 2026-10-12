// meshNet.ts — red P2P configurable (P3). NO hay señalización por defecto: y-webrtc
// usaría servidores públicos (filtra room, IPs y tiempos), así que la malla queda
// apagada (lista vacía → sin red) hasta que el dispositivo se empareja o se configura
// una URL de forma explícita.
// Prioridad: override explícito (payload de pairing P6) → localStorage swal.signaling
// → env PUBLIC_SWAL_SIGNALING → [] (sin malla).
// Para LAN 100% offline: setSignalingUrls(['ws://192.168.x.y:4444']).
const LS_KEY = 'swal.signaling';

function readEnv(): string[] {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.PUBLIC_SWAL_SIGNALING;
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter((s) => /^(wss?|https?):\/\//.test(s));
  } catch {
    return [];
  }
}

function readStored(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is string => typeof s === 'string' && /^(wss?|https?):\/\//.test(s));
  } catch {
    return [];
  }
}

export function resolveSignalingUrls(override?: string[]): string[] {
  const clean = (arr: string[]) => arr.map((s) => s.trim()).filter((s) => /^(wss?|https?):\/\//.test(s));
  if (override && override.length > 0) {
    const c = clean(override);
    if (c.length > 0) return c;
  }
  const stored = readStored();
  if (stored.length > 0) return stored;
  const env = readEnv();
  if (env.length > 0) return env;
  return [];
}

/** Persistente: lo que P6 guarda al unirse por pairing. */
export function setSignalingUrls(urls: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY, JSON.stringify(urls));
  } catch {
    /* almacenamiento no disponible: se pierde al recargar, no rompe */
  }
}

export function clearSignalingUrls(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

/** ¿Hay señalización configurada explícitamente (malla habilitada)? */
export function isMeshEnabled(urls: string[] = resolveSignalingUrls()): boolean {
  return urls.length > 0;
}

/** Compat: antes distinguía LAN de público; ahora cualquier URL es explícita. */
export function isLocalMesh(urls: string[] = resolveSignalingUrls()): boolean {
  return isMeshEnabled(urls);
}
