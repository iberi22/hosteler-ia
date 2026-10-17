import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { ENC_FORMAT } from './backupCrypto';
import { createEncryptedBackup } from './backupData';
import { disableProtection, enableProtection, lock, resetDeviceLockForTests, unlock } from './deviceLock';
import { ensureIdentity, resetIdentityCacheForTests } from './identity';
import { getLocal, getStoredLocal, resetLocalDbForTests, setLocal, updateLocalAtomically } from './localDb';
import { KV_STORE, kvDb, resetLocalStoresForTests } from './localStores';
import { isEncryptedBlob } from './rowCrypto';
import { resetStorageGateForTests } from './storageGate';

// El almacen clave/valor guarda VALORES con su tipo. El bug que cubre esta suite: `{...value}` expandia un
// string como objeto de indices (`{0:'A',1:'B',...}`) y el codigo de recuperacion dejaba de ser un string
// (`toUpperCase` reventaba al hacer la copia de seguridad).

const FAST = { policy: { iterations: 10 } };
const CODE = 'ABCD-EFGH-JKMN-PQRS';

async function wipeKv(): Promise<void> {
  await (await kvDb()).clear(KV_STORE);
}

beforeEach(async () => {
  await wipeKv();
  resetLocalStoresForTests();
  resetLocalDbForTests();
  resetIdentityCacheForTests();
  resetDeviceLockForTests();
  resetStorageGateForTests();
});

describe('localDb: tipos de valor', () => {
  it('devuelve el string tal cual (sin expandirlo como objeto)', async () => {
    await setLocal('recoveryCode', CODE);
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
  });

  it('devuelve objetos y numeros tal cual', async () => {
    await setLocal('settings', { publishedSlug: 'mi-local', tableCount: 3 });
    await setLocal('onboarding', { step: 6, completed: true });
    expect(await getLocal('settings')).toEqual({ publishedSlug: 'mi-local', tableCount: 3 });
    expect(await getLocal('onboarding')).toEqual({ step: 6, completed: true });
  });

  it('updateLocalAtomically respeta el tipo de cada valor', async () => {
    await setLocal('settings', { tableCount: 1 });
    await updateLocalAtomically(async (tx) => {
      tx.put('recoveryCode', CODE);
      tx.put('archivedLocals', { 'local-x': { recoveryCode: CODE } });
    });
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
    expect(await getLocal('archivedLocals')).toEqual({ 'local-x': { recoveryCode: CODE } });
  });
});

describe('localDb: con la proteccion activa', () => {
  it('cifra el valor y lo devuelve con su tipo al desbloquear', async () => {
    await enableProtection('pin', '123456', undefined, FAST);
    await setLocal('recoveryCode', CODE);

    const stored = await getStoredLocal('recoveryCode');
    expect(isEncryptedBlob(stored)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(CODE);
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);

    lock();
    await expect(getLocal('recoveryCode')).rejects.toThrow();
    await unlock('pin', '123456', undefined, FAST);
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);

    // Y al desactivar vuelve a quedar en claro (desactivar descifra antes de borrar el sobre).
    await disableProtection();
    expect(isEncryptedBlob(await getStoredLocal('recoveryCode'))).toBe(false);
    expect(await getLocal<string>('recoveryCode')).toBe(CODE);
  });

  it('createEncryptedBackup no revienta con el codigo guardado (toUpperCase)', async () => {
    await ensureIdentity();
    await enableProtection('pin', '123456', undefined, FAST);
    await setLocal('recoveryCode', CODE);

    const { envelope, filename } = await createEncryptedBackup();
    expect(envelope.format).toBe(ENC_FORMAT);
    expect(filename).toMatch(/^fize-.+\.fize$/);

    await disableProtection();
  });

  it('un valor cifrado sin sobre NO se devuelve como si fuera dato', async () => {
    await (await kvDb()).put(KV_STORE, { __enc: 'v1.aaaa.bbbb' }, 'recoveryCode');
    await expect(getLocal('recoveryCode')).rejects.toThrow(/siguen cifrados/);
    // Y el mensaje no engaña: reactivar el bloqueo usa una DEK NUEVA, no recupera lo que cifro la vieja.
    await expect(getLocal('recoveryCode')).rejects.toThrow(/llave nueva/);
    await expect(getLocal('recoveryCode')).rejects.toThrow(/copia de seguridad/);
  });
});
