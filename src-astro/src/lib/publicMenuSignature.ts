// Contrato de la carta publicada desde un nodo local (docs/producto/NODO-LOCAL.md §2.5).
//
// El equipo del restaurante arma la carta publica con `loadMenuBySlug` sobre su IndexedDB (los mismos
// filtros que en la nube: sin platos ocultos ni no disponibles, descripciones sin "receta/costo"), la
// FIRMA con la llave del restaurante (ECDSA P-256 + SHA-256, WebCrypto) y la envia al Worker. El Worker
// verifica la firma contra la llave registrada para ese slug (la primera vez, con codigo de activacion)
// y guarda la instantanea. Navegador y Worker usan este mismo modulo: solo WebCrypto, sin Buffer.
import type { PublicMenuData } from './publicMenuBySlug';

export const SNAPSHOT_VERSION = 1 as const;
/** Tope por carta publicada (256 KB de JSON canonico). */
export const MAX_SNAPSHOT_BYTES = 256 * 1024;

export interface PublicMenuSnapshot {
  v: typeof SNAPSHOT_VERSION;
  slug: string;
  publishedAt: string;
  menu: PublicMenuData;
}

/** Cuerpo de `POST /api/public-menu/<slug>`. */
export interface PublishMenuRequest {
  snapshot: PublicMenuSnapshot;
  /** Llave publica del restaurante en JWK (EC P-256, solo `kty`, `crv`, `x`, `y`). */
  publicKey: JsonWebKey;
  /** Firma ECDSA P-256/SHA-256 en base64url sobre `canonicalJson(snapshot)` (formato IEEE P1363 de WebCrypto). */
  signature: string;
  /** Solo en la primera publicacion de un slug: codigo que entrega SWAL. */
  activationCode?: string;
}

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** JSON con claves ordenadas y sin espacios: la misma entrada da los mismos bytes en navegador y Worker. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function snapshotBytes(snapshot: PublicMenuSnapshot): number {
  return new TextEncoder().encode(canonicalJson(snapshot)).byteLength;
}

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** Solo los campos publicos de la llave: nunca `d` aunque llegue una JWK privada. */
export function publicJwk(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/** Huella estable de la llave publica (base64url de SHA-256 del JWK canonico); identifica al restaurante. */
export async function publicKeyFingerprint(jwk: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(publicJwk(jwk))));
  return toB64url(new Uint8Array(digest));
}

export async function generateRestaurantKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
}

export async function signSnapshot(snapshot: PublicMenuSnapshot, privateKey: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign(SIGN, privateKey, new TextEncoder().encode(canonicalJson(snapshot)));
  return toB64url(new Uint8Array(sig));
}

export async function verifySnapshot(snapshot: PublicMenuSnapshot, signature: string, jwk: JsonWebKey): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', { ...publicJwk(jwk), ext: true }, ALGO, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, fromB64url(signature), new TextEncoder().encode(canonicalJson(snapshot)));
  } catch {
    return false;
  }
}

/** Arma la peticion completa de publicacion (lado navegador). */
export async function buildPublishRequest(
  menu: PublicMenuData,
  keys: { privateKey: CryptoKey; publicKey: JsonWebKey },
  activationCode?: string,
  now: Date = new Date(),
): Promise<PublishMenuRequest> {
  const snapshot: PublicMenuSnapshot = { v: SNAPSHOT_VERSION, slug: menu.restaurant.slug, publishedAt: now.toISOString(), menu };
  const signature = await signSnapshot(snapshot, keys.privateKey);
  return { snapshot, publicKey: publicJwk(keys.publicKey), signature, ...(activationCode ? { activationCode } : {}) };
}
