/**
 * El seed de demo se ejecuta contra produccion y no debe duplicar nada.
 *
 * En 2026-10-01 una corrida duplico 12 mesas, 6 categorias y 7 insumos: las
 * entidades se creaban con POST ciego sin consultar antes si ya existian.
 *
 * Estos tests NO leen el texto del script, porque eso daba falsos verdes: el
 * bloque de mesas contiene un GET y un POST a la misma ruta, asi que una
 * asercion sobre la cadena "/api/tables" se cumplia aunque se borrara la
 * consulta previa. En su lugar se **ejecuta** el seed contra un servidor HTTP
 * en memoria que ya tiene los datos y se comprueba que crea cero.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { CLIENT } from '../config/client';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'seed-demo.mjs',
);

interface Recorded {
  posts: Array<{ path: string; body: Record<string, unknown> }>;
  gets: string[];
}

const MENU = [
  ['emp', 'Empanadas de carne', 18000],
  ['ens', 'Ensalada caprese', 24000],
  ['ban', 'Bandeja paisa', 32000],
  ['pol', 'Pollo al picante', 29000],
  ['lim', 'Limonada de menta', 9000],
].map(([id, name, price]) => ({ id, name, price }));

const INVENTARIO = [
  'Papa',
  'Carne de res',
  'Arroz',
  'Pollo',
  'Tomate',
  'Queso mozzarella',
  'Pan artesanal',
].map((name, i) => ({ id: `inv-${i}`, name }));

const CATEGORIAS = ['Entradas', 'Platos de fondo', 'Bebidas'].map((name, i) => ({
  id: `cat-${i}`,
  name,
}));

const MESAS = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `t-${n}`, number: n, restaurantId: 'rest-1' }));

const ORDENES = [
  { id: 'o-1', note: 'seed-demo:cocina-a', status: 'pending' },
  { id: 'o-2', note: 'seed-demo:cocina-b', status: 'preparing' },
  { id: 'o-3', note: 'seed-demo:pagado', status: 'paid' },
];

/** Servidor minimo: ya tiene todos los datos del demo, y registra lo que recibe. */
function startServer(state: { rows: Recorded }): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.end(JSON.stringify(body));
        };

        if (path === '/api/auth/register') return send(409, { error: 'exists' });
        if (path === '/api/auth/login') return send(200, { ok: true });

        if (req.method === 'POST') {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(raw || '{}');
          } catch {
            body = {};
          }
          state.rows.posts.push({ path, body });
          return send(201, { id: `${path}#${state.rows.posts.length}` });
        }

        state.rows.gets.push(path);
        if (path === '/api/restaurants')
          return send(200, [{ id: 'rest-1', slug: CLIENT.slug, phone: CLIENT.whatsapp }]);
        if (path === '/api/categories') return send(200, CATEGORIAS);
        if (path === '/api/inventory') return send(200, INVENTARIO);
        if (path === '/api/tables') return send(200, MESAS);
        if (path === '/api/menu-items') return send(200, MENU);
        if (path === '/api/orders') return send(200, ORDENES);
        return send(200, []);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

describe('seed-demo: con datos ya sembrados no crea nada', () => {
  let server: Server;
  let url: string;
  let stdout = '';
  const state: { rows: Recorded } = { rows: { posts: [], gets: [] } };

  beforeAll(async () => {
    const started = await startServer(state);
    server = started.server;
    url = started.url;
    // El seed ahora EXIGE DEMO_PASSWORD (no hay fallback en el repo a proposito,
    // para que la password del usuario demo no viva en git). El test usa un valor
    // ficticio local: lo que prueba es la idempotencia del seed, no la credencial.
    const out = await run('node', [scriptPath], {
      env: {
        ...process.env,
        BASE: url,
        INSTANCE: 'default',
        DEMO_PASSWORD: 'local-test-password-not-a-secret',
      },
    });
    stdout = out.stdout;
  });

  afterAll(() => {
    server?.close();
  });

  const postsTo = (path: string) => state.rows.posts.filter((p) => p.path === path);

  it('el seed corrio completo y reporto su resumen', () => {
    expect(stdout).toContain('[seed]');
    expect(stdout).toContain('CREADO/OK');
  });

  it('no crea ni una mesa cuando ya existen 1..6', () => {
    const mesas = postsTo('/api/tables');
    expect(mesas, `el seed creo ${mesas.length} mesas`).toEqual([]);
  });

  it('no crea ni una categoria cuando ya existen las tres', () => {
    const cats = postsTo('/api/categories');
    expect(cats, `el seed creo ${cats.length} categorias`).toEqual([]);
  });

  it('no crea ni un insumo cuando ya existen los siete', () => {
    const inv = postsTo('/api/inventory');
    expect(inv, `el seed creo ${inv.length} insumos`).toEqual([]);
  });

  it('no crea ni un plato cuando la carta ya esta cargada', () => {
    const menu = postsTo('/api/menu-items');
    expect(menu, `el seed creo ${menu.length} platos`).toEqual([]);
  });

  it('no crea un restaurante duplicado: reutiliza el del slug', () => {
    const rest = postsTo('/api/restaurants');
    expect(rest, `el seed creo ${rest.length} restaurantes`).toEqual([]);
  });

  it('el PATCH del telefono solo dispara si falta', () => {
    // El restaurante del servidor ya trae phone: no debe hacer ni un PATCH.
    const patches = state.rows.posts.filter((p) => p.body && p.path.includes('restaurants'));
    expect(patches).toEqual([]);
  });

  it('consulta cada familia antes de escribir', () => {
    for (const familia of [
      '/api/restaurants',
      '/api/categories',
      '/api/inventory',
      '/api/tables',
      '/api/menu-items',
      '/api/orders',
    ]) {
      expect(state.rows.gets, `${familia}: nunca se consulto`).toContain(familia);
    }
  });

  it('no crea ni transiciona ordenes cuando ya existen las tres con su nota', () => {
    const orders = state.rows.posts.filter((p) => p.path.includes('/api/orders'));
    expect(orders, `el seed hizo ${orders.length} POSTs a orders o transition`).toEqual([]);
  });
});
