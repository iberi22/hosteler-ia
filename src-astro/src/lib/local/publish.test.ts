import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdbForTests } from '../idbAdapter';
import { verifySnapshot, type PublishMenuRequest } from '../publicMenuSignature';
import { ensureIdentity, resetIdentityCacheForTests } from './identity';
import { handleLocalRequest } from './localApi';
import { deleteLocal, getSettings } from './localDb';
import { publishMenu } from './publish';

async function seed() {
  const identity = await ensureIdentity();
  const instanceId = identity.instanceId;
  const send = (path: string, method: string, body?: unknown) =>
    handleLocalRequest(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, { instanceId }).then((r) => r.json());
  await send('/api/restaurants', 'POST', { name: 'Doña Rosa', slug: 'dona-rosa', address: 'Cra 15 # 85-20', phone: '3001234567' });
  const cat = await send('/api/categories', 'POST', { name: 'Almuerzos' });
  await send('/api/menu-items', 'POST', { name: 'Ejecutivo', price: 16000, categoryId: cat.id, description: 'Sopa y seco' });
  const secret = await send('/api/menu-items', 'POST', { name: 'Bandeja', price: 28000, categoryId: cat.id, description: 'Costo 9000 por receta' });
  const gone = await send('/api/menu-items', 'POST', { name: 'Borrado', price: 1000, categoryId: cat.id });
  await send(`/api/menu-items/${gone.id}`, 'DELETE');
  const hidden = await send('/api/menu-items', 'POST', { name: 'Oculto', price: 2000, categoryId: cat.id });
  await send(`/api/menu-items/${hidden.id}`, 'PATCH', { isPublic: false });
  const sold = await send('/api/menu-items', 'POST', { name: 'Agotado', price: 3000, categoryId: cat.id });
  await send(`/api/menu-items/${sold.id}`, 'PATCH', { isAvailable: false });
  return { identity, secret };
}

describe('publishMenu', () => {
  beforeEach(async () => {
    resetIdbForTests();
    await deleteLocal('identity');
    await deleteLocal('settings');
    resetIdentityCacheForTests();
  });

  it('envía la carta pública firmada: sin borrados, ocultos, agotados ni descripciones internas', async () => {
    const { identity } = await seed();
    let sent: { url: string; body: PublishMenuRequest } | null = null;
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) as PublishMenuRequest };
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }) as typeof fetch;

    const result = await publishMenu({ activationCode: ' SWAL-1234 ', fetchFn });
    expect(result).toMatchObject({ ok: true, slug: 'dona-rosa', url: 'https://fize.swal.network/dona-rosa/menu' });
    expect(sent).not.toBeNull();
    const { url, body } = sent as unknown as { url: string; body: PublishMenuRequest };
    expect(url).toBe('/api/public-menu/dona-rosa');
    expect(body.activationCode).toBe('SWAL-1234');
    expect(body.publicKey).toEqual(identity.publicJwk);
    expect(JSON.stringify(body)).not.toContain('"d"');
    expect(body.snapshot.menu.items.map((i) => i.name).sort()).toEqual(['Bandeja', 'Ejecutivo']);
    expect(body.snapshot.menu.items.find((i) => i.name === 'Bandeja')?.description).toBeUndefined();
    expect(body.snapshot.menu.restaurant.phone).toBe('573001234567');
    expect(JSON.stringify(body.snapshot)).not.toContain(identity.instanceId);
    expect(await verifySnapshot(body.snapshot, body.signature, identity.publicJwk)).toBe(true);
    expect((await getSettings()).publishedSlug).toBe('dona-rosa');
  });

  it('endpoint aún no desplegado (404/501) o sin red: aviso amable, nada se rompe', async () => {
    await seed();
    for (const status of [404, 501]) {
      const r = await publishMenu({ fetchFn: (async () => new Response('no', { status })) as typeof fetch });
      expect(r).toMatchObject({ ok: false, reason: 'no-disponible' });
      if (!r.ok) expect(r.message).toMatch(/todavía no está disponible/);
    }
    const offline = await publishMenu({
      fetchFn: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });
    expect(offline).toMatchObject({ ok: false, reason: 'sin-red' });
    // Hoy el middleware responde 401 a la ruta (aun no publica): eso tambien es "no disponible".
    const gated = await publishMenu({ fetchFn: (async () => new Response('{"error":"Authentication required"}', { status: 401 })) as typeof fetch });
    expect(gated).toMatchObject({ ok: false, reason: 'no-disponible' });
  });

  it('traduce las respuestas reales del endpoint de publicacion', async () => {
    await seed();
    const respond = (status: number, error: string) =>
      publishMenu({ fetchFn: (async () => new Response(JSON.stringify({ ok: false, error }), { status })) as typeof fetch });
    expect(await respond(403, 'Para publicar este enlace por primera vez necesitas el código de activación que entrega SWAL.')).toMatchObject({ reason: 'codigo' });
    expect(await respond(403, 'El código de activación no es válido, ya se usó o es para otro enlace.')).toMatchObject({ reason: 'codigo' });
    expect(await respond(403, 'Este enlace ya pertenece a otro restaurante.')).toMatchObject({ reason: 'firma' });
    const sig = await respond(401, 'La firma de la carta no es válida.');
    expect(sig).toMatchObject({ reason: 'error' });
    if (!sig.ok) expect(sig.message).toMatch(/firma de la carta no es válida/);
    expect(await respond(409, 'Ya hay una versión más reciente de esta carta publicada.')).toMatchObject({ reason: 'antigua' });
    const fecha = await respond(400, 'La fecha de la carta está adelantada. Revisa la fecha y la hora del equipo.');
    if (!fecha.ok) expect(fecha.message).toMatch(/fecha de la carta está adelantada/);
    expect(await respond(413, 'x')).toMatchObject({ reason: 'tamano' });
    expect(await respond(429, 'x')).toMatchObject({ reason: 'limite' });
  });

  it('sin local configurado no envía nada', async () => {
    const r = await publishMenu({
      fetchFn: (async () => {
        throw new Error('no debe llamarse');
      }) as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false, reason: 'sin-local' });
  });
});
