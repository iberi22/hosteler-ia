// identity.ts — identidad del nodo local sin cuenta (docs/producto/NODO-LOCAL.md §2.3).
//
// La primera vez se genera la llave del restaurante (ECDSA P-256, contrato `publicMenuSignature.ts`) y se
// guarda en IndexedDB como JWK EXPORTABLE: tiene que poder viajar dentro de la copia cifrada, si no, al
// cambiar de equipo el restaurante perderia su identidad y no podria volver a publicar su carta.
// `instance_id = local-<10 caracteres base32 de sha256(llave publica)>`: estable para la misma llave.
import { canonicalJson, generateRestaurantKeyPair, publicJwk } from '../publicMenuSignature';
import { getLocal, setLocal } from './localDb';
import { setLocalInstanceId } from './localMode';
import { settlePendingRestore } from './restoreTx';

export interface LocalIdentity {
  instanceId: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  createdAt: string;
}

// Base32 Crockford en minusculas (sin i, l, o, u): legible y sin ambiguedades en una URL o un soporte.
const BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';

export function base32(bytes: Uint8Array, length: number): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
    if (out.length >= length) break;
  }
  return out;
}

/** `local-` + 10 caracteres base32 del SHA-256 del JWK publico canonico (50 bits). */
export async function deriveInstanceId(jwk: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(publicJwk(jwk))));
  return `local-${base32(new Uint8Array(digest), 10)}`;
}

/** Comprueba que una identidad (p. ej. la de una copia) es coherente: id derivado de su llave publica. */
export async function isConsistentIdentity(identity: unknown): Promise<boolean> {
  if (!identity || typeof identity !== 'object') return false;
  const id = identity as Partial<LocalIdentity>;
  if (typeof id.instanceId !== 'string' || !id.publicJwk || !id.privateJwk) return false;
  if (id.privateJwk.d === undefined || id.publicJwk.kty !== 'EC') return false;
  try {
    return (await deriveInstanceId(id.publicJwk)) === id.instanceId;
  } catch {
    return false;
  }
}

let loading: Promise<LocalIdentity | null> | null = null;
let creating: Promise<LocalIdentity> | null = null;

export function resetIdentityCacheForTests(): void {
  loading = null;
  creating = null;
  setLocalInstanceId(null);
}

/**
 * La identidad guardada, o null si este equipo aun no creo su local. Antes de leerla termina (o descarta)
 * una restauracion que se haya interrumpido, para que nadie vea la llave de un local con los datos de otro.
 */
export function loadIdentity(): Promise<LocalIdentity | null> {
  if (!loading) {
    loading = settlePendingRestore()
      .catch(() => 'none')
      .then(() => getLocal<LocalIdentity>('identity'))
      .then((identity) => {
        setLocalInstanceId(identity?.instanceId ?? null);
        return identity ?? null;
      });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Carga la identidad o, si no existe, genera la llave del restaurante y la guarda. Idempotente. */
export function ensureIdentity(): Promise<LocalIdentity> {
  if (!creating) {
    creating = (async () => {
      const existing = await loadIdentity();
      if (existing) return existing;
      const pair = await generateRestaurantKeyPair();
      const [pub, priv] = await Promise.all([
        crypto.subtle.exportKey('jwk', pair.publicKey),
        crypto.subtle.exportKey('jwk', pair.privateKey),
      ]);
      const identity: LocalIdentity = {
        instanceId: await deriveInstanceId(pub),
        publicJwk: publicJwk(pub),
        privateJwk: priv,
        createdAt: new Date().toISOString(),
      };
      await setLocal('identity', identity);
      loading = Promise.resolve(identity);
      setLocalInstanceId(identity.instanceId);
      return identity;
    })();
    creating.catch(() => {
      creating = null;
    });
  }
  return creating;
}

/** Ya guardada (restoreTx.commitLocalSwitch), la identidad pasa a ser la de esta pagina. */
export function adoptIdentity(identity: LocalIdentity): void {
  loading = Promise.resolve(identity);
  creating = null;
  setLocalInstanceId(identity.instanceId);
}

/** Llave privada lista para firmar (no exportable una vez importada: solo se usa para `sign`). */
export async function importSigningKey(identity: LocalIdentity): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', identity.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export type PersistResult = 'granted' | 'denied' | 'unsupported';

/** Pide almacenamiento persistente y devuelve el resultado para mostrarlo (paso 2 del onboarding). */
export async function requestPersistence(): Promise<PersistResult> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.persist) return 'unsupported';
  try {
    if (s.persisted && (await s.persisted())) return 'granted';
    return (await s.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
