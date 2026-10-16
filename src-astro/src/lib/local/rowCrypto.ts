// rowCrypto.ts — Row encryption using AES-GCM and AAD.
import type { DomainRecord } from '../domain';

const FORMAT = 'v1';

export function base64UrlEncode(bytes: Uint8Array): string {
    const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str: string): Uint8Array {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) {
        b64 += '=';
    }
    const binString = atob(b64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

export async function encryptRow(entity: string, row: DomainRecord, dek: CryptoKey): Promise<DomainRecord> {
  const { id, instance_id, __enc, ...businessFields } = row as any;
  if (Object.keys(businessFields).length === 0 && !row.__enc) {
     return row;
  }
  if (__enc) return row; // already encrypted

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(businessFields));
  const aadStr = `fize-db|${entity}|${id}|${instance_id}`;
  const aad = new TextEncoder().encode(aadStr);

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, dek, plaintext);

  return {
    id,
    instance_id,
    __enc: `${FORMAT}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`
  } as unknown as DomainRecord;
}

export async function decryptRow(entity: string, row: DomainRecord, dek: CryptoKey): Promise<DomainRecord> {
  if (!row.__enc) return row;

  const parts = (row.__enc as string).split('.');
  if (parts.length !== 3 || parts[0] !== FORMAT) {
    throw new Error('Formato de fila cifrada inválido');
  }

  const iv = base64UrlDecode(parts[1]) as any; //
  const ciphertext = base64UrlDecode(parts[2]) as any; //

  const aadStr = `fize-db|${entity}|${row.id}|${row.instance_id}`;
  const aad = new TextEncoder().encode(aadStr);

  let plaintext: ArrayBuffer;
  try {
     plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, dek, ciphertext as any);
  } catch (err) {
     throw new Error('Fila alterada o llave incorrecta');
  }

  const businessFields = JSON.parse(new TextDecoder().decode(plaintext));
  return {
    id: row.id,
    instance_id: row.instance_id,
    ...businessFields
  } as unknown as DomainRecord;
}
