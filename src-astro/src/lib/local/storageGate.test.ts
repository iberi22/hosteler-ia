import { afterEach, describe, expect, it } from 'vitest';

import { resetStorageGateForTests, STORAGE_GATE_LOCK, withStorageGate } from './storageGate';

// El candado de escritura: una cola por pestaña y, dentro de cada turno, el candado del origen (Web Locks)
// para que dos pestañas no se pisen. La regresion que cubre: tomar el candado FUERA de la cola ejecutaba
// la operacion dos veces (una por la cola y otra por el candado).

const originalLocks = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');

function setLocks(value: unknown): void {
  Object.defineProperty(globalThis.navigator, 'locks', { value, configurable: true });
}

afterEach(() => {
  if (originalLocks) Object.defineProperty(globalThis.navigator, 'locks', originalLocks);
  else setLocks(undefined);
  resetStorageGateForTests();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withStorageGate', () => {
  it('sin Web Locks serializa en orden de llegada', async () => {
    setLocks(undefined);
    const order: string[] = [];
    const slow = withStorageGate(async () => {
      await sleep(20);
      order.push('a');
    });
    const fast = withStorageGate(async () => {
      order.push('b');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a', 'b']);
  });

  it('con Web Locks corre cada operacion UNA sola vez y dentro del candado', async () => {
    const names: string[] = [];
    let inside = 0;
    setLocks({
      async request(name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) {
        names.push(name);
        expect(inside).toBe(0);
        inside += 1;
        try {
          return await callback({ name });
        } finally {
          inside -= 1;
        }
      },
    });

    let calls = 0;
    const value = await withStorageGate(async () => {
      calls += 1;
      return 'ok';
    });

    expect(value).toBe('ok');
    expect(calls).toBe(1);
    expect(names).toEqual([STORAGE_GATE_LOCK]);
  });
});
