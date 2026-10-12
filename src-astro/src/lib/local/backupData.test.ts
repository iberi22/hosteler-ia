import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupError, encryptBackup, generateRecoveryCode, normalizeRecoveryCode } from './backupCrypto';
import { collectBackup, createEncryptedBackup, describeBackupLocal, describeCurrentLocal, openBackup, restoreBackup } from './backupData';
import { ensureIdentity, loadIdentity, resetIdentityCacheForTests, type LocalIdentity } from './identity';
import { deleteLocal, getLocal, getSettings, setLocal, type LocalKey } from './localDb';
import { handleLocalRequest } from './localApi';
import { digestRows, digestStoredInstance, entityNames, type ArchivedLocals, type PendingRestore } from './restoreTx';
import { getIdbAdapter, resetIdbForTests } from '../idbAdapter';
import type { DomainRecord } from '../domain';

// Restaurar una copia (auditoria local-node B1/B2): atomica, y la copia de OTRO local solo con confirmacion,
// archivando el local anterior (llave, ajustes y SU codigo) sin borrar sus filas.

const KV_KEYS: LocalKey[] = ['identity', 'onboarding', 'settings', 'recoveryCode', 'archivedLocals', 'restorePending'];
const known = new Set<string>();

async function wipeInstance(instanceId: string) {
  const storage = getIdbAdapter();
  for (const entity of entityNames()) {
    for (const r of await storage.list(entity, instanceId)) await storage.del(entity, r.id, instanceId);
  }
}

/** "Otro equipo": sin filas de ninguna instancia conocida y sin nada en fize-local. */
async function freshDevice() {
  for (const inst of known) await wipeInstance(inst);
  for (const key of KV_KEYS) await deleteLocal(key);
  resetIdentityCacheForTests();
}

interface Local {
  identity: LocalIdentity;
  instanceId: string;
  code: string;
  categoryId: string;
}

async function makeLocal(name: string, slug: string, dishes: string[]): Promise<Local> {
  const identity = await ensureIdentity();
  const instanceId = identity.instanceId;
  known.add(instanceId);
  const post = async (path: string, body: unknown) => {
    const res = await handleLocalRequest(path, { method: 'POST', body: JSON.stringify(body) }, { instanceId });
    expect(res.status).toBe(201);
    return (await res.json()) as Record<string, unknown>;
  };
  const restaurant = await post('/api/restaurants', { name, slug, address: 'Cra 15 # 85-20', phone: '300 123 4567' });
  const cat = await post('/api/categories', { name: 'Almuerzos' });
  for (const dish of dishes) await post('/api/menu-items', { name: dish, price: 15000, categoryId: cat.id });
  const code = generateRecoveryCode();
  await setLocal('recoveryCode', normalizeRecoveryCode(code));
  await setLocal('onboarding', { step: 6, completed: true, restaurantId: restaurant.id });
  await setLocal('settings', { tableCount: dishes.length, publishedSlug: slug });
  return { identity, instanceId, code, categoryId: String(cat.id) };
}

async function backupFile(): Promise<string> {
  return JSON.stringify((await createEncryptedBackup()).envelope);
}

async function dishNames(instanceId: string): Promise<string[]> {
  const rows = await getIdbAdapter().list('menuItem', instanceId);
  return rows.map((r) => String((r as Record<string, unknown>).name)).sort();
}

async function expectBackupError(p: Promise<unknown>, kind: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BackupError);
  expect((err as BackupError).kind).toBe(kind);
}

/** B (otro equipo) hace su copia; luego este equipo es A, con sus propios platos. */
async function twoLocals() {
  const b = await makeLocal('Café Norte', 'cafe-norte', ['Tinto', 'Pandebono']);
  const fileB = await backupFile();
  await freshDevice();
  const a = await makeLocal('Doña Rosa', 'dona-rosa', ['Ejecutivo del día']);
  return { a, b, fileB };
}

/** Lo que importa del equipo para comprobar "no cambio nada". */
async function snapshot(instanceIds: string[]) {
  resetIdentityCacheForTests();
  const rows: Record<string, string[]> = {};
  const all: Record<string, string> = {};
  for (const inst of instanceIds) {
    rows[inst] = await dishNames(inst);
    all[inst] = await digestStoredInstance(inst); // TODAS las filas de todas las entidades
  }
  return {
    identity: (await loadIdentity())?.instanceId ?? null,
    privateD: (await loadIdentity())?.privateJwk.d ?? null,
    code: (await getLocal<string>('recoveryCode')) ?? null,
    settings: await getSettings(),
    archived: Object.keys((await getLocal<ArchivedLocals>('archivedLocals')) ?? {}),
    pending: (await getLocal('restorePending')) ?? null,
    rows,
    all,
  };
}

/** `put` de IndexedDB que falla (cuota llena) en la escritura de datos numero `n`. */
function failDataPutAt(n: number) {
  const realPut = IDBObjectStore.prototype.put;
  let count = 0;
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    if (this.name !== 'kv' && ++count === n) throw new DOMException('Cuota llena', 'QuotaExceededError');
    return realPut.apply(this, args);
  });
}

describe('restaurar: copia de OTRO local', () => {
  beforeEach(async () => {
    resetIdbForTests();
    await freshDevice();
  });
  afterEach(() => vi.restoreAllMocks());

  it('describe los dos locales para el aviso (nombre y enlace de la carta)', async () => {
    const { b, fileB } = await twoLocals();
    expect(await describeCurrentLocal()).toMatchObject({ name: 'Doña Rosa', slug: 'dona-rosa' });
    const plain = await openBackup(fileB, b.code);
    expect(describeBackupLocal(plain)).toEqual({ instanceId: b.instanceId, name: 'Café Norte', slug: 'cafe-norte' });
  });

  it('sin confirmación explícita se rechaza y el equipo queda igual', async () => {
    const { a, b, fileB } = await twoLocals();
    const before = await snapshot([a.instanceId, b.instanceId]);
    await expectBackupError(restoreBackup(fileB, b.code), 'otra-instancia');
    expect(await snapshot([a.instanceId, b.instanceId])).toEqual(before);
    expect(before.identity).toBe(a.instanceId);
  });

  it('confirmada: B queda activo con SU código; A queda archivado (llave, ajustes, su código) y sus filas intactas', async () => {
    const { a, b, fileB } = await twoLocals();
    const safetyA = await backupFile(); // lo que la pantalla descarga antes de reemplazar

    const summary = await restoreBackup(fileB, b.code, { replaceInstance: true });
    expect(summary).toMatchObject({ instanceId: b.instanceId, previousInstanceId: a.instanceId, replacedOtherLocal: true });
    expect(summary.counts.menuItem).toBe(2);

    expect((await loadIdentity())?.instanceId).toBe(b.instanceId);
    resetIdentityCacheForTests();
    expect((await loadIdentity())?.privateJwk).toEqual(b.identity.privateJwk);
    expect(await getLocal('recoveryCode')).toBe(normalizeRecoveryCode(b.code));
    expect((await getSettings()).publishedSlug).toBe('cafe-norte');
    expect(await dishNames(b.instanceId)).toEqual(['Pandebono', 'Tinto']);

    // A no se borro: filas en el equipo y su llave/codigo archivados (el codigo de B no pisa el de A).
    expect(await dishNames(a.instanceId)).toEqual(['Ejecutivo del día']);
    const archived = (await getLocal<ArchivedLocals>('archivedLocals')) ?? {};
    expect(Object.keys(archived)).toEqual([a.instanceId]);
    expect(archived[a.instanceId].identity.privateJwk).toEqual(a.identity.privateJwk);
    expect(archived[a.instanceId].recoveryCode).toBe(normalizeRecoveryCode(a.code));
    expect(archived[a.instanceId].settings.publishedSlug).toBe('dona-rosa');
    expect(await getLocal('restorePending')).toBeUndefined();

    // La copia de seguridad de A, con el codigo de A, devuelve A (y B queda archivado).
    await restoreBackup(safetyA, a.code, { replaceInstance: true });
    resetIdentityCacheForTests();
    expect((await loadIdentity())?.privateJwk).toEqual(a.identity.privateJwk);
    expect(await getLocal('recoveryCode')).toBe(normalizeRecoveryCode(a.code));
    expect((await getSettings()).publishedSlug).toBe('dona-rosa');
    expect(await dishNames(a.instanceId)).toEqual(['Ejecutivo del día']);
    const archived2 = (await getLocal<ArchivedLocals>('archivedLocals')) ?? {};
    expect(Object.keys(archived2)).toEqual([b.instanceId]);
    expect(archived2[b.instanceId].recoveryCode).toBe(normalizeRecoveryCode(b.code));
  });

  it('una escritura que falla a mitad (cuota llena) no toca nada: A sigue activo con sus datos', async () => {
    const { a, b, fileB } = await twoLocals();
    const before = await snapshot([a.instanceId, b.instanceId]);
    const spy = failDataPutAt(2);
    await expect(restoreBackup(fileB, b.code, { replaceInstance: true })).rejects.toThrow(/No se cambió nada/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    const after = await snapshot([a.instanceId, b.instanceId]);
    expect(after).toEqual(before);
    expect(after.all[b.instanceId]).toBe(await digestRows({})); // ni una fila de B a medias
  });

  it('un registro de la copia con el id de una fila de A se rechaza (conflicto) sin tocar nada', async () => {
    const b = await makeLocal('Café Norte', 'cafe-norte', ['Tinto']);
    const plainB = await collectBackup();
    await freshDevice();
    const a = await makeLocal('Doña Rosa', 'dona-rosa', ['Ejecutivo del día']);
    const [dishA] = await getIdbAdapter().list('menuItem', a.instanceId);
    const forged = {
      ...plainB,
      stores: {
        ...plainB.stores,
        menuItem: plainB.stores.menuItem.map((r) => ({ ...(r as Record<string, unknown>), id: dishA.id })),
      },
    };
    const file = JSON.stringify(await encryptBackup(forged, b.code));
    const before = await snapshot([a.instanceId, b.instanceId]);
    await expectBackupError(restoreBackup(file, b.code, { replaceInstance: true }), 'conflicto');
    expect(await snapshot([a.instanceId, b.instanceId])).toEqual(before);
  });
});

describe('restaurar: copia del MISMO local', () => {
  beforeEach(async () => {
    resetIdbForTests();
    await freshDevice();
  });
  afterEach(() => vi.restoreAllMocks());

  async function divergedLocal() {
    const a = await makeLocal('Doña Rosa', 'dona-rosa', ['Ajiaco', 'Bandeja paisa', 'Sancocho']);
    const file = await backupFile();
    // Despues de la copia: un plato nuevo, uno borrado y uno con otro precio.
    const storage = getIdbAdapter();
    const items = await storage.list('menuItem', a.instanceId);
    const byName = (n: string) => items.find((r) => (r as Record<string, unknown>).name === n) as DomainRecord;
    await storage.del('menuItem', byName('Sancocho').id, a.instanceId);
    await storage.update('menuItem', byName('Ajiaco').id, { price: 99000 }, a.instanceId);
    const res = await handleLocalRequest(
      '/api/menu-items',
      { method: 'POST', body: JSON.stringify({ name: 'Nuevo', price: 1000, categoryId: a.categoryId }) },
      { instanceId: a.instanceId },
    );
    expect(res.status).toBe(201);
    return { a, file, ajiacoId: byName('Ajiaco').id };
  }

  it('deja exactamente las filas de la copia: upsert y luego borra lo que sobra', async () => {
    const { a, file, ajiacoId } = await divergedLocal();
    const summary = await restoreBackup(file, a.code);
    expect(summary.replacedOtherLocal).toBe(false);
    expect(await dishNames(a.instanceId)).toEqual(['Ajiaco', 'Bandeja paisa', 'Sancocho']);
    const ajiaco = await getIdbAdapter().get('menuItem', ajiacoId, a.instanceId);
    expect((ajiaco as Record<string, unknown>).price).toBe(15000);
    expect(await getLocal('archivedLocals')).toEqual({});
    expect(await getLocal('restorePending')).toBeUndefined();
  });

  it('una escritura que falla a mitad deja los datos de antes, completos', async () => {
    const { a, file } = await divergedLocal();
    const before = await snapshot([a.instanceId]);
    expect(before.rows[a.instanceId]).toEqual(['Ajiaco', 'Bandeja paisa', 'Nuevo']);
    const spy = failDataPutAt(3);
    await expect(restoreBackup(file, a.code)).rejects.toThrow(/No se cambió nada/);
    spy.mockRestore();
    expect(await snapshot([a.instanceId])).toEqual(before);
  });
});

describe('restauración interrumpida (marca restorePending)', () => {
  beforeEach(async () => {
    resetIdbForTests();
    await freshDevice();
  });
  afterEach(() => vi.restoreAllMocks());

  it('si los datos ya quedaron y se cortó antes de cambiar de local, al abrir se termina el cambio', async () => {
    const { a, b, fileB } = await twoLocals();
    // Falla la transaccion de fize-local que cambia la llave (pestaña cerrada justo ahi).
    const realPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'kv' && args[1] === 'identity') throw new DOMException('cerrada', 'AbortError');
      return realPut.apply(this, args);
    });
    await expect(restoreBackup(fileB, b.code, { replaceInstance: true })).rejects.toThrow();
    spy.mockRestore();

    // Estado intermedio en disco: filas de B escritas, llave de A, marca presente. A sigue entero.
    expect(await getLocal<LocalIdentity>('identity')).toMatchObject({ instanceId: a.instanceId });
    expect(await getLocal<PendingRestore>('restorePending')).toMatchObject({ instanceId: b.instanceId });
    expect(await dishNames(a.instanceId)).toEqual(['Ejecutivo del día']);

    // "Siguiente arranque": loadIdentity termina el cambio antes de devolver la llave.
    resetIdentityCacheForTests();
    expect((await loadIdentity())?.instanceId).toBe(b.instanceId);
    expect(await getLocal('restorePending')).toBeUndefined();
    expect(await getLocal('recoveryCode')).toBe(normalizeRecoveryCode(b.code));
    const archived = (await getLocal<ArchivedLocals>('archivedLocals')) ?? {};
    expect(archived[a.instanceId].recoveryCode).toBe(normalizeRecoveryCode(a.code));
    expect(await dishNames(b.instanceId)).toEqual(['Pandebono', 'Tinto']);
    expect(await dishNames(a.instanceId)).toEqual(['Ejecutivo del día']);
  });

  it('si la transaccion de datos no se aplicó, la marca se descarta y el local sigue igual', async () => {
    const { a, b } = await twoLocals();
    const before = await snapshot([a.instanceId, b.instanceId]);
    const pending: PendingRestore = {
      v: 1,
      instanceId: b.instanceId,
      previousInstanceId: a.instanceId,
      startedAt: new Date().toISOString(),
      digest: await digestRows({ menuItem: [{ id: 'x', instance_id: b.instanceId } as DomainRecord] }),
      local: { identity: b.identity, onboarding: null, settings: {}, recoveryCode: normalizeRecoveryCode(b.code) ?? '' },
    };
    await setLocal('restorePending', pending);
    resetIdentityCacheForTests();
    expect((await loadIdentity())?.instanceId).toBe(a.instanceId);
    expect(await getLocal('restorePending')).toBeUndefined();
    expect(await snapshot([a.instanceId, b.instanceId])).toEqual(before);
  });
});

// Dos pestañas del mismo equipo (F12). El candado de restauración es Web Locks: lo suelta el navegador
// cuando la pestaña muere, así que "otra pestaña está restaurando ahora" y "esa pestaña se cerró a mitad"
// se distinguen sin depender de tiempos (una marca "fresca" no se puede descartar sin romper la
// recuperación tras cerrar la pestaña, que es justo lo que estas pruebas de arriba sí exigen).

interface LocksLike {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Web Locks de mentira: `held` es "hay una pestaña con el candado". */
function fakeWebLocks(): Set<string> {
  const held = new Set<string>();
  const locks: LocksLike = {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null); // ifAvailable y ya tomado
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
  Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
  return held;
}

function withoutWebLocks(): void {
  Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
}

/** Puerta para dejar una restauración a medias de forma determinista. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('restaurar: dos pestañas del mismo equipo', () => {
  beforeEach(async () => {
    resetIdbForTests();
    await freshDevice();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    withoutWebLocks();
  });

  it('otra pestaña que abre la app no descarta la marca de una restauración en curso', async () => {
    const { a, b, fileB } = await twoLocals();
    fakeWebLocks();
    const puerta = gate();
    const realReplace = getIdbAdapter().replaceInstanceRows.bind(getIdbAdapter());
    let primera = true;
    const spy = vi.spyOn(getIdbAdapter(), 'replaceInstanceRows').mockImplementation(async (instanceId, rows) => {
      // Solo la escritura de la pestaña A se queda a medias; las siguientes no.
      if (primera) {
        primera = false;
        await puerta.promise;
      }
      return realReplace(instanceId, rows);
    });

    const enCurso = restoreBackup(fileB, b.code, { replaceInstance: true }); // pestaña A
    await vi.waitFor(async () => expect(await getLocal('restorePending')).toBeTruthy(), { timeout: 10000 });

    // Pestaña B abre la app (loadIdentity -> settle) mientras A escribe las filas.
    resetIdentityCacheForTests();
    expect((await loadIdentity())?.instanceId).toBe(a.instanceId);

    // La marca sigue ahí: es de A, que está viva. Antes se descartaba y un cierre de A a mitad dejaba el
    // equipo sin forma de terminar la restauración.
    expect(await getLocal<PendingRestore>('restorePending')).toMatchObject({ instanceId: b.instanceId });

    puerta.open();
    expect((await enCurso).instanceId).toBe(b.instanceId);
    spy.mockRestore();
    expect(await getLocal('restorePending')).toBeUndefined();
    resetIdentityCacheForTests();
    expect((await loadIdentity())?.instanceId).toBe(b.instanceId);
    expect(await dishNames(b.instanceId)).toEqual(['Pandebono', 'Tinto']);
  });

  it('dos pestañas restaurando a la vez: la segunda no escribe nada', async () => {
    const { a, b, fileB } = await twoLocals();
    fakeWebLocks();
    const puerta = gate();
    const realReplace = getIdbAdapter().replaceInstanceRows.bind(getIdbAdapter());
    let primera = true;
    const spy = vi.spyOn(getIdbAdapter(), 'replaceInstanceRows').mockImplementation(async (instanceId, rows) => {
      if (primera) {
        primera = false;
        await puerta.promise;
      }
      return realReplace(instanceId, rows);
    });

    const primeraRestauracion = restoreBackup(fileB, b.code, { replaceInstance: true });
    await vi.waitFor(async () => expect(await getLocal('restorePending')).toBeTruthy(), { timeout: 10000 });
    const before = await snapshot([a.instanceId, b.instanceId]);

    await expectBackupError(restoreBackup(fileB, b.code, { replaceInstance: true }), 'en-curso');
    expect(await snapshot([a.instanceId, b.instanceId])).toEqual(before);

    puerta.open();
    expect((await primeraRestauracion).instanceId).toBe(b.instanceId);
    spy.mockRestore();
    expect(await getLocal('restorePending')).toBeUndefined();
    expect(await dishNames(a.instanceId)).toEqual(['Ejecutivo del día']);
  });

  it('sin Web Locks (navegador sin el candado) la restauración sigue funcionando', async () => {
    const { b, fileB } = await twoLocals();
    withoutWebLocks();
    const summary = await restoreBackup(fileB, b.code, { replaceInstance: true });
    expect(summary.instanceId).toBe(b.instanceId);
    expect(await getLocal('restorePending')).toBeUndefined();
  });
});
