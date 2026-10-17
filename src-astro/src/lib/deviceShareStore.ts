// deviceShareStore.ts — almacen LOCAL de los shares E2EE (x=1 dispositivo, x=2 recuperacion).
// Estos shares NUNCA salen del dispositivo (la nube solo tiene x=3) y NUNCA se registran en logs.
// Persistente en IndexedDB (browser). El almacen en memoria existe solo para tests.
//
// Con la proteccion de dispositivo activa los shares se guardan cifrados (rowCrypto.encryptValue), porque
// son material criptografico del local: la migracion de `enableProtection` los recorre igual que las filas
// del dominio (ver lockMigration.ts, fase `shares`).

import { getActiveDek, getLockState, LockedError } from './local/deviceLock';
import { deviceShareValueKey, isTransitionPending } from './local/lockMigration';
import { SHARES_STORE, sharesDb, resetLocalStoresForTests } from './local/localStores';
import { decryptValue, encryptValue, isEncryptedBlob, PlaintextDataError } from './local/rowCrypto';
import { withStorageGate } from './local/storageGate';

export interface DeviceShares {
  device: any;
  recovery: any;
}

export interface DeviceShareStore {
  save(id: string, s: DeviceShares): void | Promise<void>;
  load(id: string): DeviceShares | null | Promise<DeviceShares | null>;
}

export function resetDeviceShareDbForTests(): void {
  resetLocalStoresForTests();
}

function requireDek(): CryptoKey {
  const dek = getActiveDek();
  if (!dek) throw new LockedError();
  return dek;
}

/** Almacen persistente (IndexedDB). Sobrevive a recargas. Los errores se propagan (sin log del contenido). */
export function createIdbDeviceShareStore(): DeviceShareStore {
  return {
    async save(id, s) {
      const state = await getLockState();
      if (state === 'locked') throw new LockedError();
      const stored: unknown =
        state === 'unlocked' ? await encryptValue(deviceShareValueKey(id), s, requireDek()) : s;
      await withStorageGate(async () => {
        const database = await sharesDb();
        await database.put(SHARES_STORE, stored, id);
      });
    },
    async load(id) {
      const state = await getLockState();
      if (state === 'locked') throw new LockedError();
      const database = await sharesDb();
      const stored = (await database.get(SHARES_STORE, id)) as unknown;
      if (stored === undefined || stored === null) return null;
      if (state === 'off') {
        // Sin proteccion los shares estan en claro; con sobre (proteccion desactivada sin descifrar) no se
        // devuelve basura como si fuera un share.
        if (isEncryptedBlob(stored)) throw new Error(`Los shares de "${id}" siguen cifrados.`);
        return stored as DeviceShares;
      }
      if (isEncryptedBlob(stored)) return decryptValue<DeviceShares>(deviceShareValueKey(id), stored, requireDek());
      // Con la proteccion activa un share sin sobre es material inyectado... salvo a mitad de desactivar.
      if (isTransitionPending()) return stored as DeviceShares;
      throw new PlaintextDataError(`los shares de "${id}"`);
    },
  };
}

/** SOLO PARA TESTS: se pierde al recargar, por lo que no debe usarse en produccion. */
export function createMemoryDeviceShareStoreForTests(): DeviceShareStore {
  const m = new Map<string, DeviceShares>();
  return {
    save: (id, s) => void m.set(id, s),
    load: (id) => m.get(id) ?? null,
  };
}
