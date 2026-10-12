import { describe, it, expect } from 'vitest';
import { decideAccess, isPublicMenuPublishPath, isPublicPath } from '../middlewareGating';

// P0 de seguridad, comprobado contra produccion con curl SIN cookie:
//   GET /api/inventory -> 200 con 7 insumos y su unitCost (34.000 el kg de carne)
//   GET /api/orders    -> 200 con los pedidos y su dinero
//   GET /api/tables    -> 200 con los QR de las mesas
//
// decideAccess caia en `allow` para toda ruta no listada, y /api/* no estaba en
// ninguna lista. Eso rompia la promesa de "recetas privadas al 100%": los
// ingredientes no salian en la receta, pero su COSTO era publico por el
// inventario.

const user = { id: 'u1', email: 'a@b.co', name: 'A', role: 'owner' } as never;
const tier = 'socio';

describe('deny-by-default de la API', () => {
  const datosDelNegocio = [
    '/api/inventory',
    '/api/inventory/abc',
    '/api/inventory/abc/transactions',
    '/api/orders',
    '/api/orders/abc',
    '/api/orders/abc/payment',
    '/api/orders/abc/transition',
    '/api/tables',
    '/api/tables/abc',
  ];

  it.each(datosDelNegocio)('sin sesion, %s responde 401', (path) => {
    const d = decideAccess(path, null, 'free');
    expect(d.kind).toBe('deny');
    expect(d.kind === 'deny' && d.status).toBe(401);
  });

  it.each(datosDelNegocio)('con sesion, %s se permite', (path) => {
    expect(decideAccess(path, user, tier).kind).toBe('allow');
  });

  it('una API nueva desconocida queda cerrada por defecto', () => {
    // Lo que hace este fix de verdad: anadir un endpoint nuevo ya no nace
    // publico por olvido. Habria que anadirlo a PUBLIC_PREFIXES a proposito.
    expect(decideAccess('/api/futuro-cosa', null, 'free').kind).toBe('deny');
    expect(decideAccess('/api/secrets/admin', null, 'free').kind).toBe('deny');
  });

  it('lo que si es publico sigue siendo publico', () => {
    for (const p of ['/api/auth/login', '/api/auth/register', '/api/auth/me', '/api/qr/abc']) {
      expect(decideAccess(p, null, 'free').kind).toBe('allow');
    }
  });

  it('la carta del menu sigue accesible sin sesion via la ruta publica', () => {
    // El cliente final no esta logueado: es el caso de uso principal. Pero la
    // carta se sirve por /{slug}/menu, no por la API cruda.
    // 2026-10-01: /api/menu-items sin sesion devolvia las descripciones de
    // produccion interna, asi que paso a ser privada.
    expect(isPublicPath('/api/menu-items')).toBe(false);
    expect(decideAccess('/api/menu-items', null, 'free').kind).toBe('deny');
    expect(isPublicPath('/api/categories')).toBe(false);
    expect(decideAccess('/api/categories', null, 'free').kind).toBe('deny');
  });

  it('/api/menu-nutrition es publico: la carta publica pide sus totales sin sesion', () => {
    // Sin esto la tarjeta nutricional GOS de /{slug}/menu recibia 401 y nunca se mostraba.
    expect(decideAccess('/api/menu-nutrition', null, 'free').kind).toBe('allow');
    expect(isPublicPath('/api/inventory')).toBe(false);
    expect(isPublicPath('/api/recipes')).toBe(false);
  });

  it('/api/restaurants sigue publico a proposito', () => {
    // No es un descuido: nombre, direccion y telefono del restaurante son los
    // mismos datos que van en su carta publica, que cualquiera puede ver en
    // fize.swal.network/{slug}/menu. Comprobado contra produccion: solo devuelve
    // name, slug, address, phone, id e instance_id — sin costos ni pedidos.
    expect(decideAccess('/api/restaurants', null, 'free').kind).toBe('allow');
  });

  it('/dashboard sin barra final tambien exige sesion', () => {
    expect(decideAccess('/dashboard', null, 'free')).toEqual({ kind: 'redirect', to: '/login' });
    expect(decideAccess('/dashboard/', null, 'free')).toEqual({ kind: 'redirect', to: '/login' });
    expect(decideAccess('/dashboardx', null, 'free').kind).not.toBe('redirect');
  });

  it('el dashboard sigue redirigiendo a login, no dando 401', () => {
    const d = decideAccess('/dashboard/recipes', null, 'free');
    expect(d.kind).toBe('redirect');
  });

  it('la IA sigue exigiendo el tier socio', () => {
    expect(decideAccess('/api/ai/infer', null, 'free')).toEqual({ kind: 'deny', status: 401, error: 'Authentication required' });
    const vip = decideAccess('/api/ai/infer', user, 'free');
    expect(vip.kind === 'deny' && vip.status).toBe(402);
  });
});

describe('publicar carta desde un nodo local (POST /api/public-menu/<slug>)', () => {
  // El nodo local no tiene cuenta: lo autoriza la firma de la llave del restaurante (y la primera vez el
  // codigo de activacion de SWAL), que valida el endpoint. Solo ese POST queda abierto.
  it('POST sin sesion se permite', () => {
    expect(decideAccess('/api/public-menu/la-esquina', null, 'free', 'POST')).toEqual({ kind: 'allow', user: null, tier: 'free' });
    expect(decideAccess('/api/public-menu/la-esquina/', null, 'free', 'post').kind).toBe('allow');
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('%s sin sesion sigue cerrado (401)', (method) => {
    const d = decideAccess('/api/public-menu/la-esquina', null, 'free', method);
    expect(d.kind === 'deny' && d.status).toBe(401);
  });

  it.each(['/api/public-menu', '/api/public-menu/', '/api/public-menu/la-esquina/history', '/api/public-menu/a/b', '/api/public-menuX/la-esquina'])(
    'POST %s sin sesion sigue cerrado',
    (path) => {
      expect(isPublicMenuPublishPath(path, 'POST')).toBe(false);
      expect(decideAccess(path, null, 'free', 'POST').kind).toBe('deny');
    },
  );

  it('no es un prefijo publico: no se abre por isPublicPath', () => {
    expect(isPublicPath('/api/public-menu/la-esquina')).toBe(false);
  });
});
