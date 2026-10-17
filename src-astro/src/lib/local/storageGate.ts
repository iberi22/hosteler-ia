// storageGate.ts — serializa las escrituras locales entre si y con la transicion de cifrado.
//
// `enableProtection` tiene que recorrer TODOS los almacenes y cifrar lo que ya habia. Si mientras recorre
// el almacen otra pantalla escribe una fila nueva, la migracion puede leer una fila en claro, otra
// operacion cifrar esa misma fila y despues la migracion pisarla con su version antigua (se pierde la
// escritura o queda texto plano). Con este candado las dos cosas no se solapan: la migracion lo tiene
// tomado de principio a fin y cada escritura de alto nivel (`setLocal`, `updateLocalAtomically`, el
// adapter de IndexedDB, el outbox y los shares del dispositivo) pasa por la misma cola.
//
// Dentro de la pestaña la exclusion la da la cola FIFO. Entre pestañas la da Web Locks (`fize-storage`,
// disponible en navegadores modernos): el candado lo suelta el navegador cuando la pestaña muere, asi que
// tampoco queda trabado para siempre. Sin Web Locks solo se pierde la exclusion entre pestañas, nunca la
// atomicidad de cada transaccion de IndexedDB. NO reentrante: no llames a `withStorageGate` desde dentro
// de otra funcion que ya lo tenga tomado (la migracion usa helpers crudos justo por eso).
export const STORAGE_GATE_LOCK = 'fize-storage';

interface LocksLike {
  request(
    name: string,
    options: { mode?: 'exclusive' | 'shared' },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

function locksApi(): LocksLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as unknown as { locks?: LocksLike }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

let tail: Promise<unknown> = Promise.resolve();

/** Toma el candado del origen (si el navegador lo tiene) y corre `fn`; sin Web Locks, corre `fn` tal cual. */
function runGated<T>(fn: () => Promise<T>): Promise<T> {
  const locks = locksApi();
  if (!locks) return fn();
  return locks.request(STORAGE_GATE_LOCK, { mode: 'exclusive' }, () => fn()) as Promise<T>;
}

/**
 * Corre `fn` en exclusiva. La cola FIFO de la pestaña va SIEMPRE delante (tambien cuando hay Web Locks) y el
 * candado del origen se toma DENTRO de cada turno de la cola: fuera del turno, dos llamadas se pisarian
 * (y llamarian a `fn` dos veces).
 */
export function withStorageGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => runGated(fn);
  const next = tail.then(run, run);
  tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** SOLO PARA TESTS: olvida la cola en curso (cada suite arranca limpia). */
export function resetStorageGateForTests(): void {
  tail = Promise.resolve();
}
