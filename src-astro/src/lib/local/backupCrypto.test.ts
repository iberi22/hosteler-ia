import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackupError,
  ENC_FORMAT,
  KDF_ITERATIONS,
  decryptBackup,
  encryptBackup,
  formatRecoveryCode,
  generateRecoveryCode,
  normalizeRecoveryCode,
  type PlainBackup,
} from './backupCrypto';
import { collectBackup, createEncryptedBackup, restoreBackup } from './backupData';
import { ensureIdentity, loadIdentity, resetIdentityCacheForTests } from './identity';
import { deleteLocal, getLocal, getSettings, setLocal } from './localDb';
import { getIdbAdapter, resetIdbForTests } from '../idbAdapter';
import { handleLocalRequest } from './localApi';

const sample: PlainBackup = {
  format: 'swal-backup/v1',
  appId: 'hosteler-ia',
  createdAt: '2026-10-02T12:00:00.000Z',
  schemaVersion: 1,
  stores: { category: [{ id: 'c1', instance_id: 'local-x', name: 'Almuerzos' }] },
};

async function expectBackupError(p: Promise<unknown>, kind: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BackupError);
  expect((err as BackupError).kind).toBe(kind);
  return err as BackupError;
}

describe('código de recuperación', () => {
  it('16 caracteres Crockford en 4 grupos', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(generateRecoveryCode()).not.toBe(code);
  });

  it('normaliza minúsculas, espacios y letras confundibles', () => {
    expect(normalizeRecoveryCode('fz7k q2md-9xha-t4pe')).toBe('FZ7KQ2MD9XHAT4PE');
    expect(normalizeRecoveryCode('OIL0-0000-0000-0000')).toBe('0110000000000000');
    expect(normalizeRecoveryCode('FZ7K-Q2MD-9XHA')).toBeNull();
    expect(normalizeRecoveryCode('UUUU-UUUU-UUUU-UUUU')).toBeNull();
    expect(formatRecoveryCode('fz7kq2md9xhat4pe')).toBe('FZ7K-Q2MD-9XHA-T4PE');
  });
});

describe('sobre fize-backup-enc/v1', () => {
  it('ida y vuelta con el código (también escrito en minúsculas y sin guiones)', async () => {
    const code = generateRecoveryCode();
    const env = await encryptBackup(sample, code);
    expect(env.format).toBe(ENC_FORMAT);
    expect(env.kdf).toEqual({ name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS });
    expect(Object.keys(env).sort()).toEqual(['check', 'ciphertext', 'format', 'iv', 'kdf', 'salt']);
    // Nada del contenido en claro dentro del archivo.
    expect(JSON.stringify(env)).not.toContain('Almuerzos');
    const back = await decryptBackup(JSON.stringify(env), code.toLowerCase().replace(/-/g, ''));
    expect(back).toEqual(sample);
  });

  it('código errado: error claro de código', async () => {
    const env = await encryptBackup(sample, generateRecoveryCode());
    const err = await expectBackupError(decryptBackup(env, generateRecoveryCode()), 'codigo');
    expect(err.message).toMatch(/código de recuperación no es correcto/);
  });

  it('archivo alterado: error claro de archivo dañado', async () => {
    const code = generateRecoveryCode();
    const env = await encryptBackup(sample, code);
    const bytes = Uint8Array.from(atob(env.ciphertext), (c) => c.charCodeAt(0));
    bytes[5] ^= 0x01;
    const tampered = { ...env, ciphertext: btoa(String.fromCharCode(...bytes)) };
    const err = await expectBackupError(decryptBackup(tampered, code), 'alterado');
    expect(err.message).toMatch(/dañado o fue modificado/);

    await expectBackupError(decryptBackup({ ...env, kdf: { ...env.kdf, iterations: 1 } }, code), 'alterado');
  });

  it('archivo que no es copia de Fize', async () => {
    await expectBackupError(decryptBackup('no es json', generateRecoveryCode()), 'formato');
    await expectBackupError(decryptBackup('{"format":"otro"}', generateRecoveryCode()), 'formato');
  });
});

describe('copia completa del nodo local', () => {
  beforeEach(async () => {
    resetIdbForTests();
    await deleteLocal('identity');
    await deleteLocal('onboarding');
    await deleteLocal('settings');
    await deleteLocal('recoveryCode');
    resetIdentityCacheForTests();
  });

  it('exporta, borra el equipo e importa con el código: datos, llave y ajustes de vuelta', async () => {
    const identity = await ensureIdentity();
    const instanceId = identity.instanceId;
    const post = (path: string, body: unknown) =>
      handleLocalRequest(path, { method: 'POST', body: JSON.stringify(body) }, { instanceId }).then((r) => r.json());
    const cat = await post('/api/categories', { name: 'Bebidas' });
    await post('/api/menu-items', { name: 'Jugo natural', price: 6000, categoryId: cat.id });
    await setLocal('onboarding', { step: 6, completed: true });
    await setLocal('settings', { tableCount: 8 });
    const code = generateRecoveryCode();
    await setLocal('recoveryCode', normalizeRecoveryCode(code));

    const plain = await collectBackup();
    expect(plain.stores.menuItem).toHaveLength(1);
    expect(plain.local?.identity).toEqual(identity);
    expect(JSON.stringify(plain)).not.toContain(normalizeRecoveryCode(code) as string);

    const { envelope, filename } = await createEncryptedBackup();
    expect(filename).toMatch(/^fize-mi-local-\d{4}-\d{2}-\d{2}\.fize$/);
    const file = JSON.stringify(envelope);

    // "Borrar datos del sitio": se pierde todo.
    for (const r of await getIdbAdapter().list('menuItem', instanceId)) await getIdbAdapter().del('menuItem', r.id, instanceId);
    for (const r of await getIdbAdapter().list('category', instanceId)) await getIdbAdapter().del('category', r.id, instanceId);
    await deleteLocal('identity');
    await deleteLocal('settings');
    await deleteLocal('recoveryCode');
    resetIdentityCacheForTests();
    expect(await loadIdentity()).toBeNull();

    // Código errado: nada se escribe.
    await expectBackupError(restoreBackup(file, generateRecoveryCode()), 'codigo');
    resetIdentityCacheForTests();
    expect(await loadIdentity()).toBeNull();
    expect(await getIdbAdapter().list('menuItem', instanceId)).toHaveLength(0);

    const summary = await restoreBackup(file, code);
    expect(summary.instanceId).toBe(instanceId);
    expect(summary.counts.menuItem).toBe(1);
    const items = await getIdbAdapter().list('menuItem', instanceId);
    expect(items.map((r) => (r as Record<string, unknown>).name)).toEqual(['Jugo natural']);
    expect((await loadIdentity())?.privateJwk).toEqual(identity.privateJwk);
    expect((await getSettings()).tableCount).toBe(8);
    expect(await getLocal('recoveryCode')).toBe(normalizeRecoveryCode(code));
  });

  it('una copia cuya identidad no cuadra con su instance_id se rechaza como alterada', async () => {
    const identity = await ensureIdentity();
    const code = generateRecoveryCode();
    const plain = await collectBackup();
    const forged = { ...plain, local: { ...plain.local, identity: { ...identity, instanceId: 'local-0000000000' } } };
    const env = await encryptBackup(forged, code);
    await expectBackupError(restoreBackup(JSON.stringify(env), code), 'alterado');
  });
});
