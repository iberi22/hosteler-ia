// kdsAutoSeed.test.ts — en modo local, montar la cola sin `?demo=1` no escribe nada.
//
// Regresion del bloqueo del revisor final (PR #3): `KitchenQueue autoPublish`
// en /local/cocina resembraba 3 pedidos + mesas en la base REAL del
// restaurante cada vez que la cola se vaciaba. La unica puerta es
// shouldSeedKdsDemo(): sin la bandera demo es false y el componente no toca
// ninguna API de escritura (ni localFetch ni store); con `?demo=1` (intencion
// explicita, solo el E2E) siembra por la API local. El dashboard servido
// conserva su demo en memoria sin cambios.
import { describe, it, expect } from 'vitest';
import { shouldSeedKdsDemo, isDemoFlaggedUrl } from './kdsAutoSeed';

describe('kdsAutoSeed — sin bandera demo no hay escrituras en local', () => {
  it('modo local + autoPublish + cola vacia + SIN bandera: NO siembra', () => {
    expect(
      shouldSeedKdsDemo({ autoPublish: true, orderCount: 0, localMode: true, demoFlag: false }),
    ).toBe(false);
  });

  it('modo local + bandera ausente (undefined): NO siembra', () => {
    expect(shouldSeedKdsDemo({ autoPublish: true, orderCount: 0, localMode: true })).toBe(false);
  });

  it('modo local + autoPublish + cola con pedidos + CON bandera: NO siembra', () => {
    expect(
      shouldSeedKdsDemo({ autoPublish: true, orderCount: 3, localMode: true, demoFlag: true }),
    ).toBe(false);
  });

  it('modo local + autoPublish=false + CON bandera: NO siembra', () => {
    expect(
      shouldSeedKdsDemo({ autoPublish: false, orderCount: 0, localMode: true, demoFlag: true }),
    ).toBe(false);
  });

  it('modo local + CON bandera + cola vacia: SI siembra (intencion explicita del E2E)', () => {
    expect(
      shouldSeedKdsDemo({ autoPublish: true, orderCount: 0, localMode: true, demoFlag: true }),
    ).toBe(true);
  });

  it('dashboard servido + autoPublish + cola vacia: SI siembra (demo en memoria, sin cambios)', () => {
    expect(shouldSeedKdsDemo({ autoPublish: true, orderCount: 0, localMode: false })).toBe(true);
  });

  it('dashboard servido + autoPublish=false: NO siembra', () => {
    expect(shouldSeedKdsDemo({ autoPublish: false, orderCount: 0, localMode: false })).toBe(false);
  });

  it('dashboard servido + cola con pedidos: NO siembra', () => {
    expect(shouldSeedKdsDemo({ autoPublish: true, orderCount: 2, localMode: false })).toBe(false);
  });
});

describe('isDemoFlaggedUrl — solo `?demo=1` exacto', () => {
  it('detecta ?demo=1', () => {
    expect(isDemoFlaggedUrl('?demo=1')).toBe(true);
    expect(isDemoFlaggedUrl('?status=paid&demo=1')).toBe(true);
  });

  it('rechaza otros valores y ausencia', () => {
    expect(isDemoFlaggedUrl('')).toBe(false);
    expect(isDemoFlaggedUrl('?demo=0')).toBe(false);
    expect(isDemoFlaggedUrl('?demo=true')).toBe(false);
    expect(isDemoFlaggedUrl('?status=paid')).toBe(false);
  });
});
