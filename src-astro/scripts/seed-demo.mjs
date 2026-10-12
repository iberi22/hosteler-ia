#!/usr/bin/env node
// seed-demo.mjs — siembra un restaurante demo en Fi'ze (Hosteler-IA).
// Uso:
//   node scripts/seed-demo.mjs                       # contra http://localhost:4321
//   BASE=https://fize-astro.iberi22.workers.dev node scripts/seed-demo.mjs
// Es idempotente: si el usuario demo ya existe (409), reutiliza la sesion e
// ignora los 409 de los demas recursos. No imprime credenciales en logs salvo
// las que se pasan por DEMO_* (documentadas en README).

// Nombre, slug y WhatsApp del restaurante: los de la clienta (src/config/client.ts). Node >= 22.18
// importa el .ts directo (solo tipos borrables).
import { CLIENT } from '../src/config/client.ts';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const INSTANCE = process.env.INSTANCE ?? 'default';

// La password del usuario demo NUNCA vive en el repo: se lee del entorno
// (secret store / .env local). Sin DEMO_PASSWORD el seed aborta — un fallback
// hardcodeado convertiria este archivo en una credencial de produccion
// filtrada a todo el que tenga acceso de lectura al repo.
if (!process.env.DEMO_PASSWORD) {
  console.error(
    '[seed] FATAL: falta DEMO_PASSWORD.\n' +
      '       Define la password del usuario demo en el entorno (secret store / .env).\n' +
      '       No hay valor por defecto a proposito: una password en el repo es una\n' +
      '       credencial de produccion accesible a cualquiera con acceso al repo.',
  );
  process.exit(1);
}

const DEMO = {
  email: process.env.DEMO_EMAIL ?? 'demo@fize.app',
  password: process.env.DEMO_PASSWORD,
  name: process.env.DEMO_NAME ?? CLIENT.restaurantName,
};

let cookie = '';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 200);
  }
  return { status: res.status, data };
}

const created = [];
const skipped = [];

// 1) Usuario demo (register). 409 = ya existe -> seguimos con login.
// /api/auth/* ignora ?instance_id= y usa siempre la instancia del despliegue.
console.log(`[seed] base=${BASE} instance=${INSTANCE}`);
let r = await api('/api/auth/register', {
  method: 'POST',
  body: { email: DEMO.email, password: DEMO.password, name: DEMO.name },
});
if (r.status === 409) {
  console.log('[seed] usuario ya existe, se hace login');
  r = await api('/api/auth/login', {
    method: 'POST',
    body: { email: DEMO.email, password: DEMO.password },
  });
}
if (r.status !== 200 && r.status !== 201) {
  console.error('[seed] FATAL: no se pudo autenticar', r.status, r.data);
  process.exit(1);
}
created.push(`user ${DEMO.email}`);

// 2) Restaurante (idempotente por slug)
const demoSlug = CLIENT.slug;
const demoPhone = process.env.DEMO_PHONE ?? CLIENT.whatsapp;
const existingRestaurants = (await api('/api/restaurants?instance_id=' + INSTANCE)).data;
const existingRest = Array.isArray(existingRestaurants)
  ? existingRestaurants.find((x) => x?.slug === demoSlug)
  : null;

let restaurantId;
if (existingRest) {
  created.push(`restaurant ${demoSlug} -> ya existia (skip)`);
  restaurantId = existingRest.id;
  if (!existingRest.phone) {
    await api(`/api/restaurants/${restaurantId}?instance_id=` + INSTANCE, {
      method: 'PATCH',
      body: { phone: demoPhone },
    });
  }
} else {
  r = await api('/api/restaurants?instance_id=' + INSTANCE, {
    method: 'POST',
    body: { name: DEMO.name, slug: demoSlug, phone: demoPhone, address: 'Calle Demo 123, Bogotá' },
  });
  created.push(`restaurant -> HTTP ${r.status}`);
  restaurantId = r.data?.id;
}

// 3) Categorias (idempotente por nombre)
//
// Sin esta consulta cada corrida del seed duplica las categorias: el POST es
// ciego y el dashboard acababa mostrando "Entradas" tres veces.
const existingCategories = (await api('/api/categories?instance_id=' + INSTANCE)).data;
const existingCats = Array.isArray(existingCategories) ? existingCategories : [];
const catIds = {};
for (const [name, description] of [
  ['Entradas', 'Para empezar'],
  ['Platos de fondo', 'Platos fuertes de la casa'],
  ['Bebidas', 'Sin alcohol'],
]) {
  const found = existingCats.find((x) => x?.name === name);
  if (found) {
    catIds[name] = found.id;
    created.push(`category ${name} -> ya existia (skip)`);
    continue;
  }
  const c = await api('/api/categories?instance_id=' + INSTANCE, {
    method: 'POST',
    body: { name, description: description.trim() },
  });
  catIds[name] = c.data?.id;
  created.push(`category ${name} -> HTTP ${c.status}`);
}

// 4) Inventario (con stock y costo) — base de las recetas
//
// El costo por unidad importa: sin el, `costPerServing` da 0 y el margen del
// menu seria una mentira. Precios de referencia de un restaurante en Colombia
// (2026), por kg / por unidad.
// Inventario (idempotente por nombre)
//
// Igual que las categorias: sin consultar antes, cada corrida duplicaba los
// insumos y las recetas apuntaban a copias distintas.
const existingInventory = (await api('/api/inventory?instance_id=' + INSTANCE)).data;
const existingInv = Array.isArray(existingInventory) ? existingInventory : [];
const inv = {};
for (const [key, name, stock, unit, unitCost] of [
  ['papa', 'Papa', 40, 'kg', 4200],
  ['carne', 'Carne de res', 25, 'kg', 34000],
  ['arroz', 'Arroz', 30, 'kg', 4600],
  ['pollo', 'Pollo', 20, 'kg', 19000],
  ['tomate', 'Tomate', 15, 'kg', 6800],
  ['queso', 'Queso mozzarella', 8, 'kg', 28000],
  ['pan', 'Pan artesanal', 30, 'unidad', 2500],
]) {
  const found = existingInv.find((x) => x?.name === name);
  if (found) {
    inv[key] = found.id;
    created.push(`inventory ${name} -> ya existia (skip)`);
    continue;
  }
  const i = await api('/api/inventory?instance_id=' + INSTANCE, {
    method: 'POST',
    body: { name, initialStock: stock, minStock: unit === 'kg' ? 5 : 10, unit, unitCost },
  });
  inv[key] = i.data?.id;
  created.push(`inventory ${name} -> HTTP ${i.status}`);
}

// 5) Menu con recetas (los pedidos descuenta el ledger)
const menu = [
  ['Empanadas de carne', 18000, 'Entradas', 'Empanadas crujientes rellenas de carne sazonada', [['carne', 0.15], ['pan', 2]]],
  ['Ensalada caprese', 24000, 'Entradas', 'Tomates frescos con queso mozzarella y albahaca', [['tomate', 0.2], ['queso', 0.15]]],
  ['Bandeja paisa', 32000, 'Platos de fondo', 'Tradicional bandeja paisa con chicharrón, carne, arroz y papas', [['arroz', 0.2], ['carne', 0.25], ['papa', 0.2], ['tomate', 0.1]]],
  ['Pollo al picante', 29000, 'Platos de fondo', 'Jugoso pollo marinado en salsa de chiles acompañados de papa', [['pollo', 0.3], ['papa', 0.2]]],
  ['Limonada de menta', 9000, 'Bebidas', 'Refrescante limonada natural con menta fresca', []],
];
// Idempotencia por nombre: antes el seed hacia POST a ciegas, asi que cada
// corrida duplicaba los 5 platos y la carta publica los mostraba DOS veces
// (mismo nombre, precio y descripcion, con ids distintos). Ahora consulta lo
// existente y solo crea lo que falta.
const existingMenu = (await api('/api/menu-items?instance_id=' + INSTANCE)).data;
const menuNames = new Set(
  (Array.isArray(existingMenu) ? existingMenu : []).map((m) => String(m?.name ?? '')),
);
for (const [name, price, cat, description, recipe] of menu) {
  if (menuNames.has(name)) {
    created.push(`menuItem ${name} -> ya existia (skip)`);
    continue;
  }
  const m = await api('/api/menu-items?instance_id=' + INSTANCE, {
    method: 'POST',
    body: {
      name,
      price,
      categoryId: catIds[cat] ?? 'demo-cat',
      description,
      recipe: recipe.map(([k, qty]) => ({ inventoryId: inv[k] ?? 'demo-inv', qty })),
    },
  });
  created.push(`menuItem ${name} -> HTTP ${m.status}`);
}

// Mesas con QR (idempotente por numero + restaurante)
//
// El POST a ciegas triplicaba las mesas 1..6 en cada corrida.
const existingTables = (await api('/api/tables?instance_id=' + INSTANCE)).data;
const existingTbls = Array.isArray(existingTables) ? existingTables : [];
for (let n = 1; n <= 6; n++) {
  const found = existingTbls.find(
    (x) => x?.number === n && (x?.restaurantId ?? restaurantId) === restaurantId,
  );
  if (found) {
    created.push(`table ${n} -> ya existia (skip)`);
    continue;
  }
  const t = await api('/api/tables?instance_id=' + INSTANCE, {
    method: 'POST',
    body: { number: n, capacity: n <= 2 ? 2 : n <= 4 ? 4 : 6, restaurantId },
  });
  created.push(`table ${n} -> HTTP ${t.status}`);
}


// 7) Pedidos
const existingMenuForOrders = (await api('/api/menu-items?instance_id=' + INSTANCE)).data;
const existingTablesForOrders = (await api('/api/tables?instance_id=' + INSTANCE)).data;
const menuItem = (Array.isArray(existingMenuForOrders) ? existingMenuForOrders : []).find((m) => m?.name === 'Empanadas de carne');
const table1 = (Array.isArray(existingTablesForOrders) ? existingTablesForOrders : []).find((t) => t?.number === 1 && (t?.restaurantId ?? restaurantId) === restaurantId);

if (!menuItem || !table1) {
  skipped.push('orders -> falta Empanadas de carne o mesa 1');
} else {
  const existingOrders = (await api('/api/orders?instance_id=' + INSTANCE)).data;
  const existingOrds = Array.isArray(existingOrders) ? existingOrders : [];

  const targetOrders = [
    { note: 'seed-demo:cocina-a', transitions: [] },
    { note: 'seed-demo:cocina-b', transitions: ['preparing'] },
    { note: 'seed-demo:pagado', transitions: ['preparing', 'ready', 'served', 'paid'] },
  ];

  for (const { note, transitions } of targetOrders) {
    const found = existingOrds.find((o) => o?.note === note);
    if (found) {
      created.push(`order ${note} -> ya existia (skip)`);
      continue;
    }

    const o = await api('/api/orders?instance_id=' + INSTANCE, {
      method: 'POST',
      body: { tableId: table1.id, items: [{ menuItemId: menuItem.id, qty: 1 }], note },
    });

    if (o.status !== 201) {
      skipped.push(`order ${note} -> fallo POST (${o.status})`);
      continue;
    }
    created.push(`order ${note} -> HTTP ${o.status}`);

    const orderId = o.data?.id;
    if (orderId) {
      for (const to of transitions) {
        const t = await api(`/api/orders/${orderId}/transition?instance_id=` + INSTANCE, {
          method: 'POST',
          body: { to },
        });
        if (t.status !== 200) {
          skipped.push(`order ${note} -> fallo transition ${to} (${t.status})`);
          break;
        }
      }
    }
  }
}

console.log('\n[seed] CREADO/OK:');
for (const c of created) console.log('  +', c);
if (skipped.length) {
  console.log('\n[seed] OMITIDO/ERROR:');
  for (const s of skipped) console.log('  -', s);
}
console.log(`\n[seed] login demo: ${DEMO.email}`);
console.log(`[seed] password demo: ${DEMO.password}`);
console.log(`[seed] menu publico: ${BASE}/menu/<restaurantId>`);
