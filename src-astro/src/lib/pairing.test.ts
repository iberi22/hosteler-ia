import { describe, it, expect } from 'vitest';
import { buildPairing, parsePairingText, parseManualCode, keyedRoom } from './pairing';

const ROOM = 'swal/fize-astro/default';
const RELAY = 'ws://192.168.1.50:9000';

describe('pairing QR', () => {
  it('build → parse roundtrip', () => {
    const b = buildPairing({ relayUrl: RELAY, room: ROOM, deviceName: 'Caja-1', now: 1000 });
    const p = parsePairingText(b.qrText, 1000);
    expect(p.relay).toBe(RELAY);
    expect(p.room).toBe(ROOM);
    expect(p.key).toBe(b.key);
    expect(p.via).toBe('qr');
    expect(p.name).toBe('Caja-1');
  });

  it('rechaza QR expirado', () => {
    const b = buildPairing({ relayUrl: RELAY, room: ROOM, ttlMs: 1000, now: 1000 });
    expect(() => parsePairingText(b.qrText, 1000 + 1001)).toThrow(/expirado/);
  });

  it('rechaza QR no-JSON, versión y room ajeno', () => {
    expect(() => parsePairingText('hola', 0)).toThrow(/no es JSON/);
    expect(() => parsePairingText('{"v":2}', 0)).toThrow(/versión/);
    expect(() => parsePairingText(JSON.stringify({ v: 1, relay: RELAY, room: 'otro/x', key: 'K', exp: 999 }), 0)).toThrow(/namespace/);
  });

  it('claves efímeras distintas en cada build', () => {
    const a = buildPairing({ relayUrl: RELAY, room: ROOM, now: 1 });
    const b = buildPairing({ relayUrl: RELAY, room: ROOM, now: 1 });
    expect(a.key).not.toBe(b.key);
  });
});

describe('pairing código manual', () => {
  it('build → parse roundtrip (incluye instancia terminada en 0)', () => {
    const b = buildPairing({ relayUrl: RELAY, room: 'swal/fize-astro/caja10', now: 5 });
    expect(b.manualCode).not.toBeNull();
    const p = parseManualCode(b.manualCode as string, 'fize-astro');
    expect(p.relay).toBe(RELAY);
    expect(p.room).toBe('swal/fize-astro/caja10');
    expect(p.key).toBe(b.key);
    expect(p.via).toBe('manual');
  });

  it('tolera minúsculas y guiones al tipear', () => {
    const b = buildPairing({ relayUrl: RELAY, room: ROOM, now: 5 });
    const lower = (b.manualCode as string).toLowerCase();
    const p = parseManualCode(lower, 'fize-astro');
    expect(p.room).toBe(ROOM);
  });

  it('rechaza checksum corrupto y formato', () => {
    const b = buildPairing({ relayUrl: RELAY, room: ROOM, now: 5 });
    const code = b.manualCode as string;
    const last = code[code.length - 1];
    const bad = code.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect(() => parseManualCode(bad, 'fize-astro')).toThrow(/checksum/);
    expect(() => parseManualCode('corto', 'fize-astro')).toThrow(/formato/);
  });

  it('hostname (no IPv4) → solo QR', () => {
    const b = buildPairing({ relayUrl: 'ws://nodo-local:9000', room: ROOM, now: 5 });
    expect(b.manualCode).toBeNull();
    expect(() => parsePairingText(b.qrText, 5)).not.toThrow();
  });
});

describe('keyedRoom', () => {
  it('une secreto al room', () => {
    expect(keyedRoom(ROOM, 'ABC')).toBe(`${ROOM}#k=ABC`);
  });
});

describe('registro de claves del host', () => {
  it('registra, lista, consume una sola vez', async () => {
    const { registerIssuedKey, consumeIssuedKey, listIssuedKeys } = await import('./pairing');
    try { localStorage.clear(); } catch { /* noop */ }
    registerIssuedKey('KEY1', 'Caja-2', Date.now() + 60000);
    expect(listIssuedKeys().map((k) => k.key)).toEqual(['KEY1']);
    expect(consumeIssuedKey('KEY1')).toBe(true);
    expect(consumeIssuedKey('KEY1')).toBe(false); // un solo uso
    expect(listIssuedKeys()).toEqual([]);
  });

  it('expiradas no se consumen ni listan', async () => {
    const { registerIssuedKey, consumeIssuedKey, listIssuedKeys } = await import('./pairing');
    try { localStorage.clear(); } catch { /* noop */ }
    registerIssuedKey('OLD', 'x', Date.now() - 1000);
    expect(consumeIssuedKey('OLD')).toBe(false);
    expect(listIssuedKeys()).toEqual([]);
  });

  it('conexión emparejada persiste y se revoca', async () => {
    const { savePairedConnection, getPairedConnection, revokePairing } = await import('./pairing');
    try { localStorage.clear(); } catch { /* noop */ }
    expect(getPairedConnection()).toBeNull();
    savePairedConnection({ room: `${ROOM}#k=K`, relay: RELAY, key: 'K', name: 'n', joinedAt: 1 });
    expect(getPairedConnection()?.room).toBe(`${ROOM}#k=K`);
    revokePairing();
    expect(getPairedConnection()).toBeNull();
  });
});
