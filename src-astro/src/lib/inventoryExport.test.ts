import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getMemoryAdapter } from './domain';
import { appendTx } from './inventoryLedger';
import {
  buildInventorySnapshot,
  sealInventorySnapshot,
  openInventorySnapshot,
  inventoryExportFilename,
  InventoryExportError,
  EXPORT_FORMAT,
  ENC_EXPORT_FORMAT
} from './inventoryExport';

describe('Inventory Export', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const seedData = async (instanceId = 'default', suffix = '') => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();

    await adapter.create('restaurant', {
      id: 'r1' + suffix,
      instance_id: instanceId,
      name: 'Mi Restaurante',
      slug: 'mi-rest' + suffix,
      address: 'Calle 1',
      created_at: now,
      updated_at: now
    });

    await adapter.create('inventoryItem', {
      id: 'i1' + suffix,
      instance_id: instanceId,
      name: 'Harina',
      unit: 'kg',
      stock: 0,
      sku: 'H-01',
      gosIngredientId: 'G-123',
      gramsPerUnit: 1000,
      costPerUnit: 2500,
      minStock: 5,
      created_at: now,
      updated_at: now
    });

    await adapter.create('inventoryItem', {
      id: 'i2' + suffix,
      instance_id: instanceId,
      name: 'Huevos',
      unit: 'un',
      stock: 0,
      created_at: now,
      updated_at: now
    });

    // Soft-deleted item
    await adapter.create('inventoryItem', {
      id: 'i3' + suffix,
      instance_id: instanceId,
      name: 'Sal',
      unit: 'g',
      stock: 0,
      deleted_at: now,
      created_at: now,
      updated_at: now
    });

    await appendTx(adapter, instanceId, 'i1' + suffix, 'purchase', 20, 'compra 1');
    await appendTx(adapter, instanceId, 'i1' + suffix, 'use', 5, 'uso 1');
    await appendTx(adapter, instanceId, 'i1' + suffix, 'waste', 1, 'merma 1');
    await appendTx(adapter, instanceId, 'i2' + suffix, 'purchase', 30, 'compra 2');
    await appendTx(adapter, instanceId, 'i2' + suffix, 'adjust', -2, 'ajuste 1');

    await adapter.create('inventoryTx', {
      id: 'tx-deleted' + suffix,
      instance_id: instanceId,
      inventoryId: 'i1' + suffix,
      kind: 'purchase',
      qty: 99,
      signedQty: 99,
      deleted_at: now,
      created_at: now,
      updated_at: now
    });
  };

  async function catchError(promise: Promise<unknown>): Promise<InventoryExportError> {
    try {
      await promise;
      throw new Error('Expected promise to reject');
    } catch (err) {
      if (err instanceof InventoryExportError) return err;
      throw err;
    }
  }

  it('buildInventorySnapshot: mapea el ledger con dos items, omitiendo soft-deleted', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');

    expect(snap.format).toBe(EXPORT_FORMAT);
    expect(snap.locations).toHaveLength(1);
    expect(snap.locations[0].name).toBe('Mi Restaurante');
    expect(snap.items).toHaveLength(2); // i3 skipped
  });

  it('buildInventorySnapshot: mapea todos los campos requeridos de items', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');

    const harina = snap.items.find(i => i.id === 'i1');
    expect(harina).toBeDefined();
    expect(harina?.quantity).toBe(14); // 20 - 5 - 1
    expect(harina?.cost).toBe(2500);
    expect(harina?.minStock).toBe(5);
    expect(harina?.customFields.sku).toBe('H-01');
    expect(harina?.customFields.gosIngredientId).toBe('G-123');
    expect(harina?.customFields.gramsPerUnit).toBe('1000');
  });

  it('buildInventorySnapshot: excluye filas de otra instance_id (cross-tenant isolation)', async () => {
    await seedData('default', '-def');
    await seedData('otra-instancia', '-otra');

    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    expect(snap.items).toHaveLength(2); // Solo los de 'default'
    expect(snap.movements.length).toBe(5);

    for (const mov of snap.movements) {
      if (mov.id.startsWith('itx-open-')) continue; // skip opening balance txs
      expect(mov.itemId.endsWith('-def')).toBe(true);
    }
  });

  it('buildInventorySnapshot: extrae los 5 movimientos exactos con signos correctos', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');

    const moves = snap.movements;
    const harinaMoves = moves.filter(m => m.itemId === 'i1');
    const huevMoves = moves.filter(m => m.itemId === 'i2');

    const purchase1 = harinaMoves.find(m => m.kind === 'purchase' && m.qty > 0);
    const use1 = harinaMoves.find(m => m.kind === 'use');
    const waste1 = harinaMoves.find(m => m.kind === 'waste');

    const purchase2 = huevMoves.find(m => m.kind === 'purchase' && m.qty > 0);
    const adjust1 = huevMoves.find(m => m.kind === 'adjust' && m.qty === -2);

    expect(use1?.qty).toBe(-5);
    expect(waste1?.qty).toBe(-1);
    expect(adjust1).toBeDefined();

    const deletedTx = moves.find(m => m.id === 'tx-deleted');
    expect(deletedTx).toBeUndefined();
    expect(purchase1?.qty).toBe(20);
    expect(purchase2?.qty).toBe(30);

    // stock inicial era 0 para ambos, así que no se generó adjust inicial.
    // harina: 3 tx (purchase, use, waste)
    // huevos: 2 tx (purchase, adjust)
    expect(moves).toHaveLength(5);
  });

  it('seal y open roundtrip: deep equality despues de decodificar', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');

    const enc = await sealInventorySnapshot(snap, 'mi_passphrase_123');
    expect(enc.format).toBe(ENC_EXPORT_FORMAT);
    expect(enc.ciphertext).toBeDefined();
    expect(enc.check).toBeDefined(); // HMAC check presente

    const opened = await openInventorySnapshot(enc, 'mi_passphrase_123');
    expect(opened).toEqual(snap);
  });

  it('openInventorySnapshot: falla si la passphrase es incorrecta (clave)', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'mi_passphrase_123');

    const err = await catchError(openInventorySnapshot(enc, 'otra_passphrase'));
    expect(err.kind).toBe('clave');
  });

  it('openInventorySnapshot: un byte modificado en el ciphertext devuelve alterado (porque check falla o descifrado falla con check)', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'secreta');

    // Modificamos un byte válido del ciphertext
    const bin = atob(enc.ciphertext);
    const modifiedBin = String.fromCharCode(bin.charCodeAt(0) ^ 1) + bin.substring(1);
    const tampered = { ...enc, ciphertext: btoa(modifiedBin) };

    const err = await catchError(openInventorySnapshot(tampered, 'secreta'));
    expect(err.kind).toBe('alterado');
  });

  it('openInventorySnapshot: falla por falta de check si no lo tiene (check es requerido)', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'secreta');

    const legacyEnc = { ...enc };
    delete legacyEnc.check;

    const err = await catchError(openInventorySnapshot(legacyEnc, 'mala'));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: kdf iterations alterado da alterado', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'secreta');

    const tampered = { ...enc, kdf: { ...enc.kdf, iterations: 100 } };
    const err = await catchError(openInventorySnapshot(tampered, 'secreta'));
    expect(err.kind).toBe('alterado');
  });

  it('openInventorySnapshot: acepta el documento plain directamente (JSON string y object)', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');

    const openedObj = await openInventorySnapshot(snap);
    expect(openedObj.items).toHaveLength(2);

    const openedStr = await openInventorySnapshot(JSON.stringify(snap));
    expect(openedStr.items).toHaveLength(2);
  });

  it('openInventorySnapshot: rechaza inputs malformados (string no json)', async () => {
    const err = await catchError(openInventorySnapshot('no-es-json'));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (objeto sin format)', async () => {
    const err = await catchError(openInventorySnapshot({ algo: 'invalido' }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (format distinto)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, format: 'otro' }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (items con null)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, items: [null] }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (qty no finito)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, items: [{ ...validSnap.items[0], quantity: Infinity }] }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (fecha invalida)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, movements: [{ ...validSnap.movements[0], at: 'fecha-mala' }] }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (falta id)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, items: [{ ...validSnap.items[0], id: undefined }] }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (customFields: false)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, items: [{ ...validSnap.items[0], customFields: false }] }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (sku: { bad: 1 })', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, items: [{ ...validSnap.items[0], sku: { bad: 1 } }] }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: rechaza inputs malformados (kind: 123)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const err = await catchError(openInventorySnapshot({ ...validSnap, movements: [{ ...validSnap.movements[0], kind: 123 }] }));
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: falla por KDF con check type invalido (check: 42)', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'secreta');

    const tampered = { ...enc, check: 42 };
    const err = await catchError(openInventorySnapshot(tampered, 'secreta'));
    expect(err).toBeInstanceOf(InventoryExportError);
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: falla si base64 de salt no es estricto', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'secreta');

    const tampered = { ...enc, salt: '!@#$' };
    const err = await catchError(openInventorySnapshot(tampered, 'secreta'));
    expect(err).toBeInstanceOf(InventoryExportError);
    expect(err.kind).toBe('formato');
  });

  it('openInventorySnapshot: un byte modificado en la salt devuelve clave', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'secreta');

    const bin = atob(enc.salt);
    const modifiedBin = String.fromCharCode(bin.charCodeAt(0) ^ 1) + bin.substring(1);
    const tampered = { ...enc, salt: btoa(modifiedBin) };

    const err = await catchError(openInventorySnapshot(tampered, 'secreta'));
    expect(err).toBeInstanceOf(InventoryExportError);
    expect(err.kind).toBe('clave');
  });

  it('openInventorySnapshot: un byte modificado en el iv devuelve alterado', async () => {
    await seedData();
    const snap = await buildInventorySnapshot(getMemoryAdapter(), 'default');
    const enc = await sealInventorySnapshot(snap, 'secreta');

    const bin = atob(enc.iv);
    const modifiedBin = String.fromCharCode(bin.charCodeAt(0) ^ 1) + bin.substring(1);
    const tampered = { ...enc, iv: btoa(modifiedBin) };

    const err = await catchError(openInventorySnapshot(tampered, 'secreta'));
    expect(err).toBeInstanceOf(InventoryExportError);
    expect(err.kind).toBe('alterado');
  });

  it('buildInventorySnapshot: mapea kinds desconocidos a adjust (read)', async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();

    await adapter.create('inventoryItem', {
      id: 'i10',
      instance_id: 'default',
      name: 'Test',
      stock: 10,
      created_at: now,
      updated_at: now
    });

    await adapter.create('inventoryTx', {
      id: 'tx-unknown',
      instance_id: 'default',
      inventoryId: 'i10',
      kind: 'algo_raro',
      qty: 5,
      signedQty: 5,
      created_at: now,
      updated_at: now
    });

    const snap = await buildInventorySnapshot(adapter, 'default');
    const tx = snap.movements.find(m => m.id === 'tx-unknown');
    expect(tx?.kind).toBe('adjust');

    // Al abrir de nuevo debe parsear bien
    const opened = await openInventorySnapshot(snap);
    const openedTx = opened.movements.find(m => m.id === 'tx-unknown');
    expect(openedTx?.kind).toBe('adjust');
  });

  it('openInventorySnapshot: convierte kinds de base desconocidos a adjust (read validator)', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');

    // Modificamos el payload para forzar un kind raro
    const tamperedSnap = {
      ...validSnap,
      movements: [
        { ...validSnap.movements[0], kind: 'magic_kind' }
      ]
    };

    // El validador debe normalizarlo a adjust en lugar de fallar
    const opened = await openInventorySnapshot(tamperedSnap);
    expect(opened.movements[0].kind).toBe('adjust');
  });

  it('el snapshot generado excluye por contrato campos desconocidos/secretos como password, recoveryCode, o code', async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();

    await adapter.create('inventoryItem', {
      id: 'isecret',
      instance_id: 'default',
      name: 'Secret',
      stock: 1,
      password: 'no-ver',
      recoveryCode: 'no-ver',
      code: 'no-ver',
      token: 'no-ver-token',
      created_at: now,
      updated_at: now
    });

    const snap = await buildInventorySnapshot(adapter, 'default');
    const str = JSON.stringify(snap);

    expect(str).not.toContain('password');
    expect(str).not.toContain('recoveryCode');
    expect(str).not.toContain('code');
    expect(str).not.toContain('token');

    const tamperedSnap = JSON.parse(str);
    tamperedSnap.items[0].extra_field = 'should_drop';

    const opened = await openInventorySnapshot(tamperedSnap);
    expect('extra_field' in opened.items[0]).toBe(false);
  });

  it('sealInventorySnapshot: extra fields never reach the plaintext inside the encrypted envelope', async () => {
    await seedData();
    const validSnap = await buildInventorySnapshot(getMemoryAdapter(), 'default');

    const tampered = { ...validSnap, password: 'secret-value', token: 'token-value' } as unknown as PlainInventorySnapshot;
    const enc = await sealInventorySnapshot(tampered, 'mi_pass_123');

    const saltBin = Uint8Array.from(atob(enc.salt), c => c.charCodeAt(0));
    const passBuf = new TextEncoder().encode('mi_pass_123');

    const keyMaterial = await crypto.subtle.importKey('raw', passBuf, { name: 'PBKDF2' }, false, ['deriveBits']);
    const derivedBits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: saltBin,
      iterations: enc.kdf.iterations,
      hash: 'SHA-256'
    }, keyMaterial, 512);

    const aesKey = await crypto.subtle.importKey('raw', derivedBits.slice(0, 32), { name: 'AES-GCM' }, false, ['decrypt']);

    const ivBin = Uint8Array.from(atob(enc.iv), c => c.charCodeAt(0));
    const ctBin = Uint8Array.from(atob(enc.ciphertext), c => c.charCodeAt(0));

    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBin }, aesKey, ctBin);
    const plainStr = new TextDecoder().decode(plainBuf);

    expect(plainStr).not.toContain('password');
    expect(plainStr).not.toContain('secret-value');
    expect(plainStr).not.toContain('token');
  });

  it('un inventario de 5000 items hace roundtrip sin errores', async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();

    for (let i = 0; i < 5000; i++) {
      await adapter.create('inventoryItem', {
        id: `ibulk-${i}`,
        instance_id: 'default',
        name: `Item ${i}`,
        stock: 10,
        costPerUnit: 100,
        minStock: 2,
        created_at: now,
        updated_at: now
      });
    }

    const snap = await buildInventorySnapshot(adapter, 'default');
    expect(snap.items).toHaveLength(5000);

    const enc = await sealInventorySnapshot(snap, 'secreta');
    const opened = await openInventorySnapshot(enc, 'secreta');
    expect(opened.items).toHaveLength(5000);
  });

  it('inventoryExportFilename retorna el nombre correcto', () => {
    const d = new Date('2026-10-02T12:00:00.000Z');
    const filename = inventoryExportFilename('cualquiera', d);
    expect(filename).toBe('fize-inventario-2026-10-02.swal-inventory.json');
  });
});
