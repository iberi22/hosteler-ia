import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import type { DomainRecord } from '../domain';
import {
  decryptRow,
  decryptValue,
  encryptRow,
  encryptValue,
  isEncryptedBlob,
  PlaintextDataError,
} from './rowCrypto';

// Cifrado por fila y por valor: con la proteccion activa, un dato SIN sobre es texto plano inyectado y se
// rechaza (no se devuelve "tal cual" como si estuviera protegido).

async function newDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const row = (id: string, instance = 'local-abc', business: Record<string, unknown> = {}): DomainRecord =>
  ({ id, instance_id: instance, ...business }) as unknown as DomainRecord;

describe('rowCrypto: filas', () => {
  it('cifra los campos de negocio y deja id/instance_id en claro', async () => {
    const dek = await newDek();
    // Marcador largo e improbable: subcadenas cortas (p.ej. '22000') pueden aparecer por azar en base64.
    const MARKER = 'rowcrypto-secret-marker-9d41';
    const sealed = await encryptRow('order', row('o1', 'local-abc', { total: 22000, note: MARKER }), dek);

    expect(sealed.id).toBe('o1');
    expect(sealed.instance_id).toBe('local-abc');
    expect(isEncryptedBlob(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain(MARKER);

    const opened = await decryptRow('order', sealed, dek);
    expect(opened).toMatchObject({ id: 'o1', instance_id: 'local-abc', total: 22000, note: MARKER });
  });

  it('una fila sin campos de negocio tambien queda con sobre', async () => {
    const dek = await newDek();
    const sealed = await encryptRow('table', row('t1'), dek);
    expect(isEncryptedBlob(sealed)).toBe(true);
    expect(await decryptRow('table', sealed, dek)).toMatchObject({ id: 't1', instance_id: 'local-abc' });
  });

  it('RECHAZA una fila sin `__enc` con la proteccion activa (texto plano inyectado)', async () => {
    const dek = await newDek();
    const plain = row('o2', 'local-abc', { total: 999 });
    await expect(decryptRow('order', plain, dek)).rejects.toBeInstanceOf(PlaintextDataError);
  });

  it('la AAD amarra la fila a su entidad (moverla de store no la descifra)', async () => {
    const dek = await newDek();
    const sealed = await encryptRow('order', row('o3', 'local-abc', { total: 1 }), dek);
    await expect(decryptRow('payment', sealed, dek)).rejects.toThrow();
  });

  it('un sobre alterado no se descifra', async () => {
    const dek = await newDek();
    const sealed = await encryptRow('order', row('o4', 'local-abc', { total: 1 }), dek);
    const business = String(sealed.__enc ?? '');
    const tampered = { ...sealed, __enc: `${business.slice(0, -2)}zz` } as DomainRecord;
    await expect(decryptRow('order', tampered, dek)).rejects.toThrow();
  });
});

describe('rowCrypto: valores sueltos', () => {
  it('conserva el TIPO del valor (string, numero, array, objeto)', async () => {
    const dek = await newDek();
    const cases: unknown[] = ['ABCD-EFGH-JKMN-PQRS', 42, ['a', 'b'], { publishedSlug: 'mi-local' }, null, true];

    for (const [index, value] of cases.entries()) {
      const sealed = await encryptValue(`k${index}`, value, dek);
      expect(isEncryptedBlob(sealed)).toBe(true);
      const opened = await decryptValue(`k${index}`, sealed, dek);
      expect(opened).toEqual(value);
    }
  });

  it('un string no se expande como objeto de indices', async () => {
    const dek = await newDek();
    const value = 'ABCD-EFGH-JKMN-PQRS';
    const sealed = await encryptValue('recoveryCode', value, dek);
    const opened = await decryptValue<string>('recoveryCode', sealed, dek);
    expect(typeof opened).toBe('string');
    expect(opened.toUpperCase()).toBe(value);
  });

  it('RECHAZA un valor sin `__enc` con la proteccion activa', async () => {
    const dek = await newDek();
    await expect(decryptValue('recoveryCode', 'texto-plano', dek)).rejects.toBeInstanceOf(PlaintextDataError);
  });

  it('la AAD ata el valor a su clave (otra clave no lo descifra)', async () => {
    const dek = await newDek();
    const sealed = await encryptValue('settings', { a: 1 }, dek);
    await expect(decryptValue('identity', sealed, dek)).rejects.toThrow();
  });
});
