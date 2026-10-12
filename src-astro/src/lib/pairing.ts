// pairing.ts — emparejamiento LAN de nodos por QR o código manual (P1).
// Sin internet: el QR/código transporta {relay local, room, clave efímera}.
// El secreto viaja FUERA de banda (pantalla→cámara u oído→teclado), nunca por red.
// Room con clave: y-webrtc une a quien conozca el string exacto del room;
// la clave de 40 bits + TTL corto + un solo uso lo hace apto para LAN.
// Formato QR (JSON): {v:1, relay, room, key, exp, name}
// Código manual (Crockford, 36 chars con prefijo): FZ1-<ip7><port4><key8><len1><instN><pad><chk>
//   Layout fijo: ip(7) + port(4) + key(8) + lenInst(1) + inst(1..11) + pad'0' + chk(1) = 33 + 'FZ1'.
//   lenInst evita ambigüedad con instancias terminadas en '0'.
//   - Solo IPv4 en manual (hostname → solo-QR, se indica con code=null).

export interface PairingPayload {
  v: 1;
  relay: string;
  room: string;
  key: string;
  exp: number;
  name: string;
}

export interface BuiltPairing {
  qrText: string;
  manualCode: string | null;
  relay: string;
  room: string;
  key: string;
  expiresAt: number;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_MAP: Record<string, number> = {};
for (let i = 0; i < CROCKFORD.length; i++) CROCKFORD_MAP[CROCKFORD[i]] = i;

function randomBytes(n: number): Uint8Array {
  const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array; randomBytes?: (n: number) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    const b = new Uint8Array(n);
    g.crypto.getRandomValues(b);
    return b;
  }
  if (g.crypto?.randomBytes) return g.crypto.randomBytes(n);
  throw new Error('[pairing] sin fuente aleatoria segura');
}

function toCrockford(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}

function fromCrockford(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = CROCKFORD_MAP[ch];
    if (v === undefined) throw new Error(`[pairing] caracter inválido: ${ch}`);
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

function checksumChar(body: string): string {
  let sum = 0;
  for (const ch of body) sum = (sum + (CROCKFORD_MAP[ch] ?? 0)) % 32;
  return CROCKFORD[sum];
}

function ipv4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255 || parts[i] === '') return null;
    bytes[i] = n;
  }
  return bytes;
}

export interface BuildPairingInput {
  relayUrl: string;
  room: string;
  deviceName?: string;
  ttlMs?: number;
  now?: number;
}

export function buildPairing(input: BuildPairingInput): BuiltPairing {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
  const keyBytes = randomBytes(5);
  const key = toCrockford(keyBytes);
  const expiresAt = now + ttlMs;
  const payload: PairingPayload = {
    v: 1,
    relay: input.relayUrl,
    room: input.room,
    key,
    exp: expiresAt,
    name: input.deviceName ?? 'nodo',
  };
  return {
    qrText: JSON.stringify(payload),
    manualCode: tryManualCode(input.relayUrl, input.room, key),
    relay: input.relayUrl,
    room: input.room,
    key,
    expiresAt,
  };
}

function tryManualCode(relayUrl: string, room: string, key: string): string | null {
  let url: URL;
  try {
    url = new URL(relayUrl);
  } catch {
    return null;
  }
  const ipBytes = ipv4ToBytes(url.hostname);
  if (!ipBytes) return null; // hostname → solo QR
  const inst = room.split('/').pop() ?? '';
  if (!/^[a-z0-9-]{1,12}$/i.test(inst)) return null;
  const port = url.port ? Number(url.port) : (url.protocol === 'wss:' || url.protocol === 'https:' ? 443 : 80);
  const portBytes = new Uint8Array([(port >> 8) & 255, port & 255]);
  const instClean = inst.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (instClean.length < 1 || instClean.length > 11) return null;
  const lenChar = CROCKFORD[instClean.length];
  const raw = toCrockford(ipBytes) + toCrockford(portBytes) + key + lenChar + instClean;
  const body32 = (raw + '0'.repeat(32)).slice(0, 32);
  const chk = checksumChar(body32);
  const full = `FZ1${body32}${chk}`;
  return `${full.slice(0, 7)}-${full.slice(7, 14)}-${full.slice(14, 21)}-${full.slice(21)}`;
}

export interface ParsedPairing {
  relay: string;
  room: string;
  key: string;
  expiresAt: number;
  name: string;
  via: 'qr' | 'manual';
}

export function parsePairingText(text: string, now = Date.now()): ParsedPairing {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('[pairing] QR no es JSON de emparejamiento');
  }
  const p = obj as Record<string, unknown>;
  if (p.v !== 1) throw new Error('[pairing] versión no soportada');
  if (typeof p.relay !== 'string' || typeof p.room !== 'string' || typeof p.key !== 'string') {
    throw new Error('[pairing] payload incompleto');
  }
  if (typeof p.exp !== 'number' || p.exp <= now) throw new Error('[pairing] código expirado');
  if (!/^swal\//.test(p.room)) throw new Error('[pairing] room fuera del namespace swal/');
  return { relay: p.relay, room: p.room, key: p.key, expiresAt: p.exp, name: typeof p.name === 'string' ? p.name : 'nodo', via: 'qr' };
}

export function parseManualCode(code: string, appId: string, now = Date.now()): ParsedPairing {
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!clean.startsWith('FZ1') || clean.length !== 36) throw new Error('[pairing] formato de código inválido');
  const body = clean.slice(3, 35);
  const chk = clean.slice(35);
  if (checksumChar(body) !== chk) throw new Error('[pairing] checksum inválido');
  const ipBytes = fromCrockford(body.slice(0, 7)).slice(0, 4);
  const portBytes = fromCrockford(body.slice(7, 11)).slice(0, 2);
  const port = (portBytes[0] << 8) | portBytes[1];
  const key = body.slice(11, 19);
  const instLen = CROCKFORD_MAP[body[19]];
  if (instLen === undefined || instLen < 1 || instLen > 11) throw new Error('[pairing] longitud de instancia inválida');
  const inst = body.slice(20, 20 + instLen).toLowerCase();
  if (!inst || /[^a-z0-9]/.test(inst)) throw new Error('[pairing] instancia vacía');
  const ip = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
  void now;
  return {
    relay: `ws://${ip}:${port}`,
    room: `swal/${appId}/${inst}`,
    key,
    // Sin expiración embebida: la validez la impone el registro de claves
    // del host (un solo uso + TTL). Ver stores/pairing (P6).
    expiresAt: Number.MAX_SAFE_INTEGER,
    name: 'manual',
    via: 'manual',
  };
}

/** Room con clave: une el secreto al nombre del room y-webrtc. */
export function keyedRoom(baseRoom: string, key: string): string {
  return `${baseRoom}#k=${key}`;
}

// ─── Conexión emparejada persistida (P6) ─────────────────────────────
// Vive en lib (no en stores/) para que fleetStore/mesh la lean sin ciclos.
const PAIRED_KEY = 'swal.paired';
const ISSUED_KEY = 'swal.pairing.issued';

export interface PairedConnection {
  room: string;
  relay: string;
  key: string;
  name: string;
  joinedAt: number;
}

function lsGet(k: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function lsSet(k: string, v: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(k, v);
  } catch { /* sin persistencia: sesión volátil */ }
}

function lsDel(k: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(k);
  } catch { /* noop */ }
}

export function savePairedConnection(c: PairedConnection): void {
  lsSet(PAIRED_KEY, JSON.stringify(c));
}

export function getPairedConnection(): PairedConnection | null {
  const raw = lsGet(PAIRED_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as PairedConnection;
    if (typeof o.room !== 'string' || typeof o.relay !== 'string') return null;
    return o;
  } catch {
    return null;
  }
}

export function clearPairedConnection(): void {
  lsDel(PAIRED_KEY);
}

export interface IssuedKey {
  key: string;
  name: string;
  expiresAt: number;
  consumed: boolean;
}

/** Registro de claves emitidas por ESTE nodo (lado host). TTL 5 min, un solo uso. */
export function registerIssuedKey(key: string, name: string, expiresAt: number): void {
  const raw = lsGet(ISSUED_KEY);
  let arr: IssuedKey[] = [];
  try {
    if (raw) arr = JSON.parse(raw) as IssuedKey[];
  } catch { arr = []; }
  arr = arr.filter((k) => k.expiresAt > Date.now() && !k.consumed);
  arr.push({ key, name, expiresAt, consumed: false });
  lsSet(ISSUED_KEY, JSON.stringify(arr));
}

/** Marca consumida; false si no existe, expiró o ya se usó. */
export function consumeIssuedKey(key: string): boolean {
  const raw = lsGet(ISSUED_KEY);
  if (!raw) return false;
  try {
    const arr = JSON.parse(raw) as IssuedKey[];
    const it = arr.find((k) => k.key === key);
    if (!it || it.consumed || it.expiresAt <= Date.now()) return false;
    it.consumed = true;
    lsSet(ISSUED_KEY, JSON.stringify(arr));
    return true;
  } catch {
    return false;
  }
}

export function listIssuedKeys(): IssuedKey[] {
  const raw = lsGet(ISSUED_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as IssuedKey[];
    return arr.filter((k) => k.expiresAt > Date.now() && !k.consumed);
  } catch {
    return [];
  }
}

/** Revoca todo: limpia emitidas y rompe el emparejamiento activo. */
export function revokePairing(): void {
  lsDel(ISSUED_KEY);
  clearPairedConnection();
}
