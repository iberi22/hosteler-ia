// pairing.svelte.ts — store runes del emparejamiento LAN (P6).
// Host: issue → QR/código (clave registrada con TTL). Join: QR/código →
// persiste conexión (room con clave + relay local) y resetea el bus P2P.
import {
  buildPairing,
  parsePairingText,
  parseManualCode,
  keyedRoom,
  savePairedConnection,
  getPairedConnection,
  registerIssuedKey,
  consumeIssuedKey,
  listIssuedKeys,
  revokePairing,
  type BuiltPairing,
} from '../lib/pairing';
import { fleetRoom } from '../lib/yjsFleet';
import { setSignalingUrls, clearSignalingUrls } from '../lib/meshNet';
import { domainConfig } from '../lib/domain.config';

export type PairStatus = 'idle' | 'hosting' | 'joining' | 'paired' | 'error';

export const pairing = $state<{
  status: PairStatus;
  current: BuiltPairing | null;
  pairedRoom: string | null;
  relay: string | null;
  error: string | null;
}>({
  status: 'idle',
  current: null,
  pairedRoom: null,
  relay: null,
  error: null,
});

export function pairingInit() {
  const c = getPairedConnection();
  if (c) {
    pairing.status = 'paired';
    pairing.pairedRoom = c.room;
    pairing.relay = c.relay;
  }
}

function defaultRelay(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.PUBLIC_SWAL_RELAY;
    if (env) return env;
  } catch { /* noop */ }
  return 'ws://192.168.1.50:4444';
}

/** Lado host: emite invitación (registra clave con TTL). */
export function issuePairing(relayUrl?: string, deviceName?: string) {
  pairing.error = null;
  const relay = (relayUrl ?? defaultRelay()).trim();
  if (!/^(wss?|https?):\/\//.test(relay)) {
    pairing.status = 'error';
    pairing.error = 'Relay inválido (ej: ws://192.168.1.50:9000).';
    return;
  }
  const room = fleetRoom();
  const built = buildPairing({ relayUrl: relay, room, deviceName });
  registerIssuedKey(built.key, deviceName ?? 'nodo', built.expiresAt);
  pairing.current = built;
  pairing.status = 'hosting';
}

/** Lado join por QR escaneado. */
export async function joinWithQr(text: string) {
  pairing.error = null;
  pairing.status = 'joining';
  try {
    const p = parsePairingText(text);
    await applyJoin(p.relay, p.room, p.key, p.name);
  } catch (e) {
    pairing.status = 'error';
    pairing.error = e instanceof Error ? e.message : 'QR inválido.';
  }
}

/** Lado join por código manual. Validez: registro del host + rotación (ver docs). */
export async function joinWithCode(code: string) {
  pairing.error = null;
  pairing.status = 'joining';
  try {
    const p = parseManualCode(code, domainConfig.appId as string);
    await applyJoin(p.relay, p.room, p.key, p.name);
  } catch (e) {
    pairing.status = 'error';
    pairing.error = e instanceof Error ? e.message : 'Código inválido.';
  }
}

async function applyJoin(relay: string, room: string, key: string, name: string) {
  const keyed = keyedRoom(room, key);
  setSignalingUrls([relay]);
  savePairedConnection({ room: keyed, relay, key, name, joinedAt: Date.now() });
  try {
    const mesh = await import('../lib/mesh');
    (mesh as unknown as { resetMeshBus?: () => Promise<void> }).resetMeshBus?.();
  } catch { /* bus se crea con la nueva red al publicar */ }
  pairing.pairedRoom = keyed;
  pairing.relay = relay;
  pairing.status = 'paired';
}

/** Rompe el emparejamiento y vuelve a red por defecto. */
export async function leavePairing() {
  revokePairing();
  clearSignalingUrls();
  try {
    const mesh = await import('../lib/mesh');
    (mesh as unknown as { resetMeshBus?: () => Promise<void> }).resetMeshBus?.();
  } catch { /* noop */ }
  pairing.status = 'idle';
  pairing.current = null;
  pairing.pairedRoom = null;
  pairing.relay = null;
  pairing.error = null;
}

/** Host confirma que el invitado entró: consume la clave (un solo uso). */
export function confirmGuestJoined(key: string): boolean {
  return consumeIssuedKey(key);
}

export function pendingKeys() {
  return listIssuedKeys();
}
