// rowCrypto.ts — cifrado de filas del dominio y de valores del almacen clave/valor (AES-GCM + AAD).
//
// Una fila cifrada conserva SOLO `id` y `instance_id` en claro (los necesita el indice `by-instance` y el
// adapter para listar por instancia): todo lo demas va dentro del sobre `v1.<iv>.<ciphertext>` del campo
// `__enc`. Los valores sueltos del almacen clave/valor (el codigo de recuperacion, la llave del
// restaurante, los ajustes) usan el MISMO sobre, pero con su propia AAD (`fize-kv|<clave>`), porque el
// valor puede ser un string, un array o un numero y no un objeto de negocio.
//
// La AAD amarra el texto cifrado a su sitio (`fize-db|<entidad>|<id>|<instancia>` o `fize-kv|<clave>`):
// mover una fila de store o de id no la descifra. El formato va dentro del propio sobre, asi que una
// version futura se distingue sin adivinar.

import type { DomainRecord } from '../domain';

const FORMAT = 'v1';
export const ENC_FIELD = '__enc';

export interface EncryptedBlob {
  [ENC_FIELD]: string;
}

/** Dato que deberia estar cifrado y no lo esta: con la proteccion activa es una inyeccion de texto plano. */
export class PlaintextDataError extends Error {
  constructor(where: string) {
    super(`Hay datos sin cifrar en ${where}: la proteccion de este equipo esta activa, asi que no se leen.`);
    this.name = 'PlaintextDataError';
  }
}

export function base64UrlEncode(bytes: Uint8Array<ArrayBufferLike>): string {
  let binString = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binString += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `Uint8Array<ArrayBuffer>` y no `Uint8Array` a secas: `BufferSource` de WebCrypto no acepta
 *  `SharedArrayBuffer` y `Uint8Array.from` ya devuelve el buffer normal. */
export function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  const binString = atob(b64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

/** Un objeto con `__enc` string es un sobre; cualquier otra cosa es dato en claro. */
export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return !!value && typeof value === 'object' && typeof (value as EncryptedBlob)[ENC_FIELD] === 'string';
}

function aad(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

function rowAad(entity: string, id: unknown, instanceId: unknown): string {
  return `fize-db|${entity}|${String(id)}|${String(instanceId)}`;
}

export function valueAad(key: string): string {
  return `fize-kv|${key}`;
}

/** Cifra y devuelve el sobre `v1.<iv>.<ciphertext>`. */
export async function sealString(dek: CryptoKey, additionalData: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(additionalData) },
    dek,
    new TextEncoder().encode(plaintext),
  );
  return `${FORMAT}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

/** Abre un sobre `v1.<iv>.<ciphertext>`. Lanza si el formato, la AAD o la llave no cuadran. */
export async function openSealedString(dek: CryptoKey, additionalData: string, blob: string): Promise<string> {
  const parts = blob.split('.');
  if (parts.length !== 3 || parts[0] !== FORMAT) throw new Error('Formato de dato cifrado invalido');
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = base64UrlDecode(parts[1]);
    ciphertext = base64UrlDecode(parts[2]);
  } catch {
    throw new Error('Formato de dato cifrado invalido');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(additionalData) },
      dek,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Dato alterado o llave incorrecta');
  }
}

/**
 * Cifra los campos de negocio de una fila. SIEMPRE deja `__enc`, aunque la fila no tenga mas campos: una
 * fila sin `__enc` con la proteccion activa es indistinguible de texto plano inyectado (ver `decryptRow`).
 */
export async function encryptRow(entity: string, row: DomainRecord, dek: CryptoKey): Promise<DomainRecord> {
  const source = row as unknown as Record<string, unknown>;
  const id = source.id;
  const instanceId = source.instance_id;
  const businessFields: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (key === 'id' || key === 'instance_id' || key === ENC_FIELD) continue;
    businessFields[key] = source[key];
  }
  const blob = await sealString(dek, rowAad(entity, id, instanceId), JSON.stringify(businessFields));
  return { id, instance_id: instanceId, [ENC_FIELD]: blob } as unknown as DomainRecord;
}

/**
 * Descifra una fila. Con la proteccion activa una fila SIN `__enc` NO se acepta: devolverla tal cual
 * dejaria entrar texto plano por la puerta de atras (una fila escrita a mano en IndexedDB, o un
 * almacen que la migracion no alcanzo) y la pantalla lo mostraria como si estuviera protegido.
 */
export async function decryptRow(entity: string, row: DomainRecord, dek: CryptoKey): Promise<DomainRecord> {
  if (!isEncryptedBlob(row)) {
    throw new PlaintextDataError(`la fila ${entity}/${String((row as { id?: unknown })?.id)}`);
  }
  const plaintext = await openSealedString(dek, rowAad(entity, row.id, row.instance_id), row[ENC_FIELD]);
  const businessFields = JSON.parse(plaintext) as Record<string, unknown>;
  return { id: row.id, instance_id: row.instance_id, ...businessFields } as unknown as DomainRecord;
}

/** Cifra un valor suelto del almacen clave/valor conservando su tipo (string, numero, array, objeto). */
export async function encryptValue(key: string, value: unknown, dek: CryptoKey): Promise<EncryptedBlob> {
  const json = JSON.stringify(value === undefined ? null : value);
  return { [ENC_FIELD]: await sealString(dek, valueAad(key), json) };
}

/** Descifra un valor suelto. Con la proteccion activa un valor sin sobre se rechaza (ver `decryptRow`). */
export async function decryptValue<T>(key: string, stored: unknown, dek: CryptoKey): Promise<T> {
  if (!isEncryptedBlob(stored)) throw new PlaintextDataError(`el valor "${key}"`);
  const plaintext = await openSealedString(dek, valueAad(key), stored[ENC_FIELD]);
  return JSON.parse(plaintext) as T;
}
