import { describe, it, expect } from 'vitest';
import { CloudflareVaultAdapter } from './cloudflareVaultAdapter';

// P0: `create` NUNCA fallaba. El catch global degradaba a memoria y la funcion
// devolvia el record como si estuviera guardado, asi que:
//
//   POST /api/purchases -> 200 con el stock aplicado
//   GET  /api/purchases -> []   (D1 sin filas, el registro vivia en el isolate)
//
// Eso paso con pagos, recetas y compras, tres veces, siempre con un 200/201 en
// la cara. El `if (!saved)` que pusimos en compras era codigo muerto: create no
// puede devolver null ni falsy, siempre devuelve el record.
//
// Estos tests fijan que un fallo de AMBOS almacenamientos suba como excepcion.

/** Adapter con R2 y D1 que rechazan, para simular el storage caido. */
function brokenAdapter() {
  const env = {
    SWAL_D1: {
      prepare: () => ({
        bind: () => ({ run: async () => { throw new Error('D1 NOT NULL constraint failed'); } }),
      }),
      exec: async () => undefined,
    },
    SWAL_R2: { put: async () => { throw new Error('R2 unavailable'); } },
  };
  return new CloudflareVaultAdapter(env as never, 'app-fize' as never);
}

describe('cloudflareVaultAdapter.create — la persistencia no puede fallar en silencio', () => {
  const record = {
    id: 'pur-test-1',
    instance_id: 'default',
    supplierId: 'sup-1',
    total: 130900,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('lanza excepcion cuando ni R2 ni D1 aceptan el registro', async () => {
    const adapter = brokenAdapter();
    await expect(adapter.create('purchase', record as never)).rejects.toThrow(/create failed/);
  });

  it('el error menciona que entidad fallo, para poder diagnosticarlo del log', async () => {
    const adapter = brokenAdapter();
    await expect(adapter.create('purchase', record as never)).rejects.toThrow(/purchase\/pur-test-1/);
  });

  it('sin bindings de nube sigue funcionando en memoria (tests y dev)', async () => {
    const adapter = new CloudflareVaultAdapter({} as never, 'app-fize' as never);
    const saved = await adapter.create('purchase', record as never);
    expect(saved.id).toBe('pur-test-1');
    const rows = await adapter.list('purchase', 'default');
    expect(rows).toHaveLength(1);
  });
});
