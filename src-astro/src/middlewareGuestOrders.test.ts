import { describe, expect, it } from 'vitest';
import { decideAccess, isGuestOrderPath } from './middlewareGating';

/**
 * El cliente del restaurante no esta logueado: entra por el QR de su mesa y
 * manda su pedido desde ahi. Con el deny-by-default de 2026-10-01 ese POST
 * devolvia 401 y el pedido se perdia en silencio dentro de la cola offline.
 */
describe('pedido del cliente sin sesion', () => {
  it('permite POST /api/orders sin sesion', () => {
    const d = decideAccess('/api/orders', null, 'free', 'POST');
    expect(d.kind).toBe('allow');
  });

  it('tolera la barra final', () => {
    expect(decideAccess('/api/orders/', null, 'free', 'POST').kind).toBe('allow');
  });

  it('GET /api/orders/confirm no existe: no esta en la allowlist', () => {
    expect(decideAccess('/api/orders/confirm', null, 'free', 'GET').kind).toBe('deny');
  });
});

describe('lo que sigue privado tras abrir el POST', () => {
  it('GET /api/orders sigue denegado: es el listado con el dinero del local', () => {
    const d = decideAccess('/api/orders', null, 'free', 'GET');
    expect(d).toEqual({ kind: 'deny', status: 401, error: 'Authentication required' });
  });

  it('DELETE /api/orders sigue denegado', () => {
    expect(decideAccess('/api/orders', null, 'free', 'DELETE').kind).toBe('deny');
  });

  it('la transicion de estado no se abre: mover pedidos es del local', () => {
    expect(decideAccess('/api/orders/abc/transition', null, 'free', 'POST').kind).toBe('deny');
    expect(isGuestOrderPath('/api/orders/abc/transition', 'POST')).toBe(false);
  });

  it('PATCH sobre un pedido sigue denegado', () => {
    expect(decideAccess('/api/orders/abc', null, 'free', 'PATCH').kind).toBe('deny');
  });

  it('el listado por sub-ruta sigue denegado', () => {
    expect(decideAccess('/api/orders/recent', null, 'free', 'GET').kind).toBe('deny');
  });
});

describe('isGuestOrderPath es exacto, no por prefijo', () => {
  it('no acepta rutas que empiezan igual pero no son la Coleccion', () => {
    // El fallo cl\u00e1sico de una allowlist por prefijo: '/api/ordersX'
    // o '/api/orders-admin' empezarian igual.
    expect(isGuestOrderPath('/api/orders-admin', 'POST')).toBe(false);
    expect(isGuestOrderPath('/api/ordersx', 'POST')).toBe(false);
  });

  it('solo acepta POST en la coleccion', () => {
    expect(isGuestOrderPath('/api/orders', 'POST')).toBe(true);
    expect(isGuestOrderPath('/api/orders', 'GET')).toBe(false);
    expect(isGuestOrderPath('/api/orders/confirm', 'GET')).toBe(false);
    expect(isGuestOrderPath('/api/orders/confirm', 'POST')).toBe(false);
  });
});

describe('sin regresion: las APIs del negocio siguen cerradas', () => {
  it('inventario, recetas y compras no se abren por accidente', () => {
    for (const p of ['/api/inventory', '/api/recipes', '/api/purchases', '/api/menu-items']) {
      for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) {
        expect(decideAccess(p, null, 'free', m).kind, `${m} ${p}`).toBe('deny');
      }
    }
  });

  it('con sesion todo sigue funcionando como antes', () => {
    const user = { id: 'u1', email: 'a@b.c', instanceId: 'i1' } as never;
    expect(decideAccess('/api/orders', user, 'free', 'GET').kind).toBe('allow');
    expect(decideAccess('/api/inventory', user, 'free', 'GET').kind).toBe('allow');
  });
});