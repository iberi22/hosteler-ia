import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { base32, deriveInstanceId, ensureIdentity, importSigningKey, isConsistentIdentity, loadIdentity, resetIdentityCacheForTests } from './identity';
import { deleteLocal } from './localDb';
import { getCachedLocalInstanceId } from './localMode';
import { publicKeyFingerprint, signSnapshot, verifySnapshot, type PublicMenuSnapshot } from '../publicMenuSignature';

const FIXED_JWK: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
  y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
};

describe('identidad del nodo local', () => {
  beforeEach(async () => {
    await deleteLocal('identity');
    resetIdentityCacheForTests();
  });

  it('instance_id = local- + 10 base32 de sha256(llave pública), estable', async () => {
    const a = await deriveInstanceId(FIXED_JWK);
    expect(a).toMatch(/^local-[0-9a-hjkmnp-tv-z]{10}$/);
    // Misma llave (aunque llegue con `d`, `ext` o en otro orden) = mismo id.
    expect(await deriveInstanceId({ y: FIXED_JWK.y, x: FIXED_JWK.x, crv: 'P-256', kty: 'EC', ext: true, d: 'privado' })).toBe(a);
    expect(await deriveInstanceId({ ...FIXED_JWK, x: FIXED_JWK.y, y: FIXED_JWK.x })).not.toBe(a);
    // Valor fijo: si cambia la derivacion, cambian los instance_id de todos los equipos ya creados.
    expect(a).toMatchInlineSnapshot(`"local-m2h35gqhjj"`);
    // Comparte la huella del contrato (SHA-256 del JWK canonico), solo cambia la codificacion.
    expect(await publicKeyFingerprint(FIXED_JWK)).toBeTypeOf('string');
  });

  it('base32 Crockford toma los bits en orden', () => {
    expect(base32(new Uint8Array([0, 0]), 3)).toBe('000');
    expect(base32(new Uint8Array([0xff, 0xff]), 3)).toBe('zzz');
    expect(base32(new Uint8Array([0b00001000, 0b01000000]), 3)).toBe('110');
  });

  it('la primera vez crea la llave, la guarda exportable y la reutiliza', async () => {
    expect(await loadIdentity()).toBeNull();
    const [a, b] = await Promise.all([ensureIdentity(), ensureIdentity()]);
    expect(a).toEqual(b);
    expect(a.privateJwk.d).toBeTypeOf('string');
    expect(a.publicJwk).toEqual({ kty: 'EC', crv: 'P-256', x: a.publicJwk.x, y: a.publicJwk.y });
    expect(a.instanceId).toBe(await deriveInstanceId(a.publicJwk));
    expect(getCachedLocalInstanceId()).toBe(a.instanceId);
    expect(await isConsistentIdentity(a)).toBe(true);

    resetIdentityCacheForTests();
    expect((await loadIdentity())?.instanceId).toBe(a.instanceId);
    expect((await ensureIdentity()).instanceId).toBe(a.instanceId);

    // La llave guardada firma cartas que verifica la llave publica (contrato compartido con el Worker).
    const snapshot: PublicMenuSnapshot = {
      v: 1,
      slug: 'dona-rosa',
      publishedAt: '2026-10-02T00:00:00.000Z',
      menu: { restaurant: { id: 'r', name: 'Doña Rosa', slug: 'dona-rosa' }, categories: [], items: [] },
    };
    const sig = await signSnapshot(snapshot, await importSigningKey(a));
    expect(await verifySnapshot(snapshot, sig, a.publicJwk)).toBe(true);
  });
});
