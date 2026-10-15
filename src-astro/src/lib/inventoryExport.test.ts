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

  const seedData = async (instanceId = 'default') => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();

    await adapter.create('restaurant', {
      id: 'r1',
      instance_id: instanceId,
      name: 'Mi Restaurante',
      slug: 'mi-rest',
      address: 'Calle 1',
      created_at: now,
      updated_at: now
    });

    await adapter.create('inventoryItem', {
      id: 'i1',
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
      id: 'i2',
      instance_id: instanceId,
      name: 'Huevos',
      unit: 'un',
      stock: 0,
      created_at: now,
      updated_at: now
    });

    // Soft-deleted item
    await adapter.create('inventoryItem', {
      id: 'i3',
      instance_id: instanceId,
      name: 'Sal',
      unit: 'g',
      stock: 0,
      deleted_at: now,
      created_at: now,
      updated_at: now
    });

    await appendTx(adapter, instanceId, 'i1', 'purchase', 20, 'compra 1');
    await appendTx(adapter, instanceId, 'i1', 'use', 5, 'uso 1');
    await appendTx(adapter, instanceId, 'i1', 'waste', 1, 'merma 1');
    await appendTx(adapter, instanceId, 'i2', 'purchase', 30, 'compra 2');
    await appendTx(adapter, instanceId, 'i2', 'adjust', -2, 'ajuste 1');
  };

  it('buildInventorySnapshot: mapea el ledger con dos items y cinco movimientos, omitiendo eliminados', async () => {
    await seedData();
    const adapter = getMemoryAdapter();
    const snap = await buildInventorySnapshot(adapter, 'default');

    expect(snap.format).toBe(EXPORT_FORMAT);
    expect(snap.locations).toHaveLength(1);
    expect(snap.locations[0].name).toBe('Mi Restaurante');

    // Solo debe haber i1 e i2. i3 (Sal) está borrado lógicamente
    expect(snap.items).toHaveLength(2);

    const harina = snap.items.find(i => i.id === 'i1');
    expect(harina).toBeDefined();
    expect(harina?.quantity).toBe(14); // 20 - 5 - 1
    expect(harina?.cost).toBe(2500);
    expect(harina?.minStock).toBe(5);
    expect(harina?.customFields.sku).toBe('H-01');
    expect(harina?.customFields.gosIngredientId).toBe('G-123');
    expect(harina?.customFields.gramsPerUnit).toBe('1000');

    // i1 tiene 3 movimientos + saldo inicial generado por appendTx
    // i2 tiene 2 movimientos + saldo inicial
    const i1Moves = snap.movements.filter(m => m.itemId === 'i1');
    const kinds1 = i1Moves.map(m => m.kind);
    expect(kinds1).toContain('purchase');
    expect(kinds1).toContain('use');
    expect(kinds1).toContain('waste');
  });

  it('buildInventorySnapshot: asigna cantidades con signo correcto', async () => {
    await seedData();
    const adapter = getMemoryAdapter();
    const snap = await buildInventorySnapshot(adapter, 'default');

    const harinaMoves = snap.movements.filter(m => m.itemId === 'i1');
    const purchase = harinaMoves.find(m => m.kind === 'purchase');
    const use = harinaMoves.find(m => m.kind === 'use');
    const waste = harinaMoves.find(m => m.kind === 'waste');

    expect(purchase?.qty).toBeGreaterThan(0);
    expect(use?.qty).toBeLessThan(0);
    expect(waste?.qty).toBeLessThan(0);
  });

  it('seal y open roundtrip', async () => {
    await seedData();
    const adapter = getMemoryAdapter();
    const snap = await buildInventorySnapshot(adapter, 'default');

    const enc = await sealInventorySnapshot(snap, 'mi_passphrase_123');
    expect(enc.format).toBe(ENC_EXPORT_FORMAT);
    expect(enc.ciphertext).toBeDefined();

    const opened = await openInventorySnapshot(enc, 'mi_passphrase_123');
    expect(opened.format).toBe(EXPORT_FORMAT);
    expect(opened.items).toHaveLength(2);
  });

  it('openInventorySnapshot: falla cerrado con wrong passphrase (clave)', async () => {
    await seedData();
    const adapter = getMemoryAdapter();
    const snap = await buildInventorySnapshot(adapter, 'default');

    const enc = await sealInventorySnapshot(snap, 'mi_passphrase_123');

    await expect(openInventorySnapshot(enc, 'otra_passphrase'))
      .rejects.toThrow(new InventoryExportError('clave'));
  });

  it('openInventorySnapshot: falla si el archivo encriptado es alterado (mal json en texto)', async () => {
    await seedData();
    const adapter = getMemoryAdapter();
    const snap = await buildInventorySnapshot(adapter, 'default');

    const enc = await sealInventorySnapshot(snap, 'secreta');
    const tampered = { ...enc, ciphertext: 'invalido=' }; // ciphertext mal formado que falla en atob() o produce un plain inválido

    await expect(openInventorySnapshot(tampered, 'secreta'))
      .rejects.toThrow(new InventoryExportError('alterado'));
  });

  it('openInventorySnapshot: acepta el documento plain directamente (JSON string y object)', async () => {
    await seedData();
    const adapter = getMemoryAdapter();
    const snap = await buildInventorySnapshot(adapter, 'default');

    const openedObj = await openInventorySnapshot(snap);
    expect(openedObj.items).toHaveLength(2);

    const openedStr = await openInventorySnapshot(JSON.stringify(snap));
    expect(openedStr.items).toHaveLength(2);
  });

  it('openInventorySnapshot: rechaza formato incorrecto (formato)', async () => {
    await expect(openInventorySnapshot({ algo: 'invalido' }))
      .rejects.toThrow(new InventoryExportError('formato'));

    await expect(openInventorySnapshot('no-es-json'))
      .rejects.toThrow(new InventoryExportError('formato'));
  });

  it('buildInventorySnapshot: mapea kinds desconocidos a adjust', async () => {
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

    // Insertamos directamente sin pasar por appendTx
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
    const txs = snap.movements.filter(m => m.itemId === 'i10' && m.id === 'tx-unknown');
    expect(txs).toHaveLength(1);
    expect(txs[0].kind).toBe('adjust');
  });

  it('el snapshot generado nunca contiene secretos como password, recoveryCode, o code', async () => {
    await seedData();
    const adapter = getMemoryAdapter();
    const snap = await buildInventorySnapshot(adapter, 'default');

    const str = JSON.stringify(snap);
    expect(str).not.toContain('password');
    expect(str).not.toContain('recoveryCode');
    expect(str).not.toContain('code');
  });

  it('inventoryExportFilename retorna el nombre correcto', () => {
    const d = new Date('2026-10-02T12:00:00.000Z');
    const filename = inventoryExportFilename('cualquiera', d);
    expect(filename).toBe('fize-inventario-2026-10-02.swal-inventory.json');
  });
});
