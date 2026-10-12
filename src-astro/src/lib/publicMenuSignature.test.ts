import { describe, it, expect } from 'vitest';
import {
  canonicalJson, buildPublishRequest, verifySnapshot, generateRestaurantKeyPair,
  publicKeyFingerprint, publicJwk, snapshotBytes,
} from './publicMenuSignature';
import type { PublicMenuData } from './publicMenuBySlug';

const menu: PublicMenuData = {
  restaurant: { id: 'r1', name: 'La Esquina', slug: 'la-esquina', phone: '573001234567' },
  categories: [{ id: 'c1', name: 'Platos' }],
  items: [{ id: 'i1', name: 'Ajiaco', price: 21000, categoryId: 'c1', isAvailable: true }],
};

async function keys() {
  const pair = await generateRestaurantKeyPair();
  return { privateKey: pair.privateKey, publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) };
}

describe('firma de la carta publicada', () => {
  it('JSON canonico: mismo resultado sin importar el orden de las claves', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it('firma valida se verifica; carta alterada o llave ajena no', async () => {
    const k = await keys();
    const req = await buildPublishRequest(menu, k, 'FZ-ACT');
    expect(req.snapshot.slug).toBe('la-esquina');
    expect(req.activationCode).toBe('FZ-ACT');
    expect(req.publicKey).not.toHaveProperty('d');
    expect(await verifySnapshot(req.snapshot, req.signature, req.publicKey)).toBe(true);

    const tampered = structuredClone(req.snapshot);
    tampered.menu.items[0].price = 1;
    expect(await verifySnapshot(tampered, req.signature, req.publicKey)).toBe(false);

    const other = await keys();
    expect(await verifySnapshot(req.snapshot, req.signature, other.publicKey)).toBe(false);
    expect(await verifySnapshot(req.snapshot, 'basura', req.publicKey)).toBe(false);
  });

  it('huella estable e independiente de campos privados de la JWK', async () => {
    const pair = await generateRestaurantKeyPair();
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    expect(await publicKeyFingerprint(pub)).toBe(await publicKeyFingerprint(priv));
    expect(publicJwk(priv)).not.toHaveProperty('d');
  });

  it('mide el tamano en bytes del JSON canonico', async () => {
    const req = await buildPublishRequest(menu, await keys());
    expect(snapshotBytes(req.snapshot)).toBeGreaterThan(50);
  });
});
