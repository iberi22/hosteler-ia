// deviceLock.ts — bloqueo del equipo: sobre de la DEK, PIN/codigo de recuperacion, intentos y transicion.
//
// Modelo (docs/producto/NODO-LOCAL.md §2.3): una DEK AES-GCM-256 aleatoria cifra los datos en reposo; la DEK
// se guarda envuelta con una KEK derivada del PIN (PBKDF2-SHA256, 600.000 iteraciones) y con otra derivada
// del codigo de recuperacion. Nada se guarda en claro salvo `id`/`instance_id` de las filas.
//
// De la DEK viva en memoria (`activeDek`) no se puede sacar el material: WebCrypto exige que la llave que
// se envuelve sea `extractable` (spec §14.3.2, `[[wrap]]` lanza InvalidAccessError si no lo es), asi que
// SOLO la llave que se pasa a `wrapKey` es extractable y dura lo que dura el envolvimiento; la que queda en
// memoria se obtiene con `unwrapKey(..., extractable:false)`. No se usa `exportKey` en ningun camino (ni
// aqui ni para cambiar el PIN: se desenvuelve en una copia temporal extractable, se vuelve a envolver y la
// copia que se guarda se desenvuelve sin permiso de exportacion). Tampoco se usa `@swal/vault/web`: este
// modulo es WebCrypto puro.
import {
  base64UrlDecode,
  base64UrlEncode,
} from './rowCrypto';
import {
  clearLockTransition,
  endLocalTransition,
  findPlaintextLeftovers,
  findEncryptedLeftovers,
  LOCK_TRANSITION_KEY,
  readLockTransition,
  runLockTransition,
  verifyLockTransition,
  writeLockTransition,
  type LockTransitionRecord,
} from './lockMigration';
import { KV_STORE, kvDb } from './localStores';
import { withStorageGate } from './storageGate';

export class LockedError extends Error {
  constructor(message = 'La aplicación está bloqueada') {
    super(message);
    this.name = 'LockedError';
  }
}

/** Demasiados intentos fallidos: hay que esperar (espera creciente; ver `LockPolicy`). */
export class LockoutError extends Error {
  constructor(readonly retryAfterMs: number, message?: string) {
    super(message ?? `Demasiados intentos. Espera ${Math.ceil(retryAfterMs / 1000)} s y vuelve a probar.`);
    this.name = 'LockoutError';
  }
}

export type LockState = 'off' | 'locked' | 'unlocked';

export interface LockEnvelope {
  method: 'pin' | 'passkey';
  /** `v1.<sal del KDF>.<iv>.<DEK envuelta>`. */
  wrappedDek: string;
  /** `v1.<sal del KDF>.<iv>.<DEK envuelta>` con la KEK del codigo de recuperacion. */
  wrappedRecovery: string;
  /** Iteraciones PBKDF2 con las que se derivo la KEK (600.000 en produccion). */
  iterations: number;
  /**
   * Generacion del sobre (aleatoria, nueva en cada activacion). La DEK que esta pestaña tiene en memoria
   * solo vale para el sobre de SU generacion; sin esto, desactivar y reactivar en otra pestaña dejaba a
   * esta escribiendo con una llave que nadie puede leer.
   */
  gen?: string;
  /**
   * Nonce de la transicion de bloqueo vigente de ESTE sobre. Los marcadores `lockTransition` lo llevan
   * dentro y se firman con el, y `completeDisable` lo rota en cada intento NUEVO: asi un marcador firmado
   * capturado de un intento anterior no se puede reutilizar para descifrar el equipo en un desbloqueo
   * posterior. Los sobres de versiones previas no lo traen (ver `envelopeTransitionNonce`).
   */
  transitionNonce?: string;
}

export interface PasskeyPrfProvider {
    getPrfOutput(salt: Uint8Array): Promise<Uint8Array>;
}

/** Parametros de seguridad. `iterations` de produccion; los tests pueden inyectar uno barato. */
export interface LockPolicy {
  /** Iteraciones PBKDF2 (produccion: 600.000). */
  iterations: number;
  /** Fallos consecutivos antes de empezar a bloquear. */
  maxAttempts: number;
  /** Espera del primer bloqueo; se duplica en cada fallo siguiente (hasta `maxDelayMs`). */
  baseDelayMs: number;
  maxDelayMs: number;
}

export const PRODUCTION_KDF_ITERATIONS = 600_000;

export const DEFAULT_LOCK_POLICY: LockPolicy = {
  iterations: PRODUCTION_KDF_ITERATIONS,
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
};

export interface LockOptions {
  /** SOLO TESTS: iteraciones PBKDF2 baratas. Sin esto, 600.000 (produccion). */
  policy?: Partial<LockPolicy>;
}

function policyOf(options?: LockOptions): LockPolicy {
  return { ...DEFAULT_LOCK_POLICY, ...(options?.policy ?? {}) };
}

const DEK_PARAMS: AesKeyGenParams = { name: 'AES-GCM', length: 256 };
const WRAP_PARAMS = { name: 'AES-GCM' } as const;
const ENVELOPE_FORMAT = 'v1';
const PIN_SALT_BYTES = 16;
const RECOVERY_SALT_BYTES = 16;
const IV_BYTES = 12;
const CODE_LENGTH = 16;
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENVELOPE_KEY = 'lockEnvelope';
const THROTTLE_KEY = 'lockThrottle';

export const LOCK_CHANNEL_NAME = 'fize-device-lock';
/** Clave del evento `storage` (respaldo cuando no hay BroadcastChannel). */
export const LOCK_STORAGE_EVENT_KEY = 'fize-device-lock-event';

let activeDek: CryptoKey | null = null;
let currentMethod: 'pin' | 'passkey' | 'recovery' | null = null;
let isLockedState = false;
/**
 * Generacion del sobre al que pertenece la DEK de memoria. Desactivar y volver a activar produce un sobre
 * nuevo (con DEK nueva): la DEK vieja NO abre los datos nuevos y hay que soltarla.
 */
let activeDekGeneration: string | null = null;

// ---------------------------------------------------------------------------
// Acceso crudo a `fize-local`
//
// El sobre y el control de intentos van en claro (hacen falta ANTES de tener la DEK) y se escriben sin pasar
// por `localDb`, porque `localDb` toma el candado de escritura y la transicion ya lo tiene tomado: pedirlo
// otra vez desde dentro seria un bloqueo mutuo.
// ---------------------------------------------------------------------------

async function readRaw<T>(key: string): Promise<T | undefined> {
  return (await (await kvDb()).get(KV_STORE, key)) as T | undefined;
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  await (await kvDb()).put(KV_STORE, value, key);
}

async function deleteRaw(key: string): Promise<void> {
  await (await kvDb()).delete(KV_STORE, key);
}

async function readEnvelope(): Promise<LockEnvelope | null> {
  return (await readRaw<LockEnvelope>(ENVELOPE_KEY)) ?? null;
}

function isEnvelope(value: unknown): value is LockEnvelope {
  if (!value || typeof value !== 'object') return false;
  const env = value as Partial<LockEnvelope>;
  return (
    (env.method === 'pin' || env.method === 'passkey') &&
    typeof env.wrappedDek === 'string' &&
    typeof env.wrappedRecovery === 'string'
  );
}

export async function getLockState(): Promise<LockState> {
  const raw = await readRaw<unknown>(ENVELOPE_KEY);
  if (!isEnvelope(raw)) return 'off';
  if (activeDek && activeDekGeneration !== envelopeGeneration(raw)) {
    // La DEK en memoria es de un sobre que ya no existe (desactivar+reactivar en otra pestaña, cambio de
    // PIN): se suelta ANTES de contestar para que nadie escriba con la llave vieja. Se avisa a la pantalla
    // porque desde aqui el equipo ya esta bloqueado.
    dropActiveDek();
    notifyLockListeners();
  }
  if (isLockedState || !activeDek) return 'locked';
  return 'unlocked';
}

/** Identidad del sobre: `gen` (sobres nuevos) con respaldo del envoltorio (sobres de versiones previas). */
function envelopeGeneration(envelope: LockEnvelope): string {
  return typeof envelope.gen === 'string' && envelope.gen.length > 0 ? envelope.gen : envelope.wrappedDek;
}

function newGeneration(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Nonce de la transicion vigente del sobre. `null` en sobres escritos por versiones previas (no lo traen):
 * esos solo admiten sus propios marcadores de entonces, y el primer intento de desactivar los actualiza.
 */
function envelopeTransitionNonce(envelope: LockEnvelope): string | null {
  return typeof envelope.transitionNonce === 'string' && envelope.transitionNonce.length > 0
    ? envelope.transitionNonce
    : null;
}

function newTransitionNonce(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Un marcador de transicion solo autoriza algo si (1) lo firmo la DEK de ESTE sobre y (2) pertenece a la
 * transicion vigente de ese sobre. Sin (1) un marcador plantado a mano mandaria sobre datos que no son
 * suyos (cifrando texto plano inyectado o descifrando el equipo); sin (2) bastaria con capturar un
 * marcador firmado en un intento anterior para volver a usarlo mas tarde.
 */
async function markerAuthorizesTransition(
  marker: LockTransitionRecord,
  dek: CryptoKey,
  envelope: LockEnvelope,
): Promise<boolean> {
  if (!(await verifyLockTransition(marker, dek))) return false;
  const nonce = envelopeTransitionNonce(envelope);
  if (nonce === null) return marker.nonce === undefined;
  return marker.nonce === nonce;
}

/** Suelta la DEK de ESTA pestaña: al recibir un aviso de otra pestaña o al detectar un sobre nuevo. */
function dropActiveDek(): void {
  activeDek = null;
  activeDekGeneration = null;
  currentMethod = null;
  isLockedState = true;
}

export function getActiveDek(): CryptoKey | null {
  return activeDek;
}

/** Lo que una escritura necesita saber DENTRO del candado: si guardar en claro o con que DEK cifrar. */
export type WriteContext = { state: 'off' } | { state: 'unlocked'; dek: CryptoKey };

/**
 * Corre `fn` con el candado de escritura tomado Y el estado releido DENTRO del candado.
 *
 * Por que: cifrar ANTES de entrar en el candado dejaba huerfanos. Si `disableProtection` tomaba el candado
 * entre el cifrado y el `put`, la fila quedaba con `{__enc}` y el sobre ya borrado: datos perdidos (la
 * llave nueva no abre lo que cifro la vieja). Aqui lo que se cifra y lo que se guarda pasan juntos por el
 * mismo turno del candado, y si la proteccion se desactivo (o se activo) mientras se esperaba, `fn` ve el
 * estado y la DEK vigentes.
 *
 * El estado se lee AQUI DENTRO (`getLockState` + `activeDek`), nunca antes de `withStorageGate`: leerlo
 * fuera devuelve la foto de ANTES de la transicion que ya tiene el candado (desactivada: la DEK vieja
 * cifra despues de que el sobre desapareciera; activada: el estado 'off' deja texto plano con la
 * proteccion puesta).
 *
 * NO reentrante (ver storageGate.ts): no lo llames desde dentro de `withStorageGate` ni desde `fn`.
 */
export function withLockedWrite<T>(fn: (ctx: WriteContext) => Promise<T>): Promise<T> {
  return withStorageGate(async () => {
    const state = await getLockState();
    if (state === 'locked') throw new LockedError();
    const dek = activeDek;
    if (state === 'unlocked' && !dek) throw new LockedError();
    return fn(dek ? { state: 'unlocked', dek } : { state: 'off' });
  });
}

// ---------------------------------------------------------------------------
// Sobre de la DEK
// ---------------------------------------------------------------------------

function packWrappedKey(salt: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, ciphertext: Uint8Array<ArrayBuffer>): string {
  return `${ENVELOPE_FORMAT}.${base64UrlEncode(salt)}.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

/** Bytes con buffer propio: `BufferSource` de WebCrypto no acepta `SharedArrayBuffer` (ver rowCrypto). */
type Bytes = Uint8Array<ArrayBuffer>;

function unpackWrappedKey(wrapped: string): { salt: Bytes; iv: Bytes; ciphertext: Bytes } {
  if (!wrapped) throw new Error('Sobre de llave vacío');
  const parts = wrapped.split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_FORMAT) throw new Error('Formato de sobre de llave inválido');
  try {
    return {
      salt: base64UrlDecode(parts[1]),
      iv: base64UrlDecode(parts[2]),
      ciphertext: base64UrlDecode(parts[3]),
    };
  } catch {
    throw new Error('Formato de sobre de llave inválido');
  }
}

/** DEK envuelta con `wrapKey` (nunca con `exportKey`): el material no pasa por JavaScript. */
async function wrapDek(dek: CryptoKey, kek: CryptoKey, salt: Bytes): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.wrapKey('raw', dek, kek, { ...WRAP_PARAMS, iv });
  return packWrappedKey(salt, iv, new Uint8Array(ciphertext));
}

/**
 * Abre el sobre. `extractable` es `false` salvo cuando hay que volver a envolver la DEK (cambiar el PIN):
 * en ese caso la copia extractable vive solo lo que dura el reenvolvimiento.
 */
async function unwrapDek(wrapped: string, kek: CryptoKey, extractable = false): Promise<CryptoKey> {
  const { iv, ciphertext } = unpackWrappedKey(wrapped);
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      ciphertext,
      kek,
      { ...WRAP_PARAMS, iv },
      DEK_PARAMS,
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new LockedError('Clave incorrecta');
  }
}

// ---------------------------------------------------------------------------
// KDF
// ---------------------------------------------------------------------------

async function derivePinKek(pin: string, iterations: number, salt?: Bytes): Promise<{ kek: CryptoKey; salt: Bytes }> {
    const s = salt ?? crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
    );
    return { kek, salt: s };
}

async function deriveRecoveryKek(code: string, iterations: number, salt: Bytes): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
    );
}

// Internal: Derives a KEK from a Passkey PRF output
async function derivePasskeyKek(prfProvider: PasskeyPrfProvider, salt?: Bytes): Promise<{ kek: CryptoKey, salt: Bytes }> {
    const s = salt || crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES));
    // Copia a un buffer propio: el proveedor puede devolver una vista sobre otro buffer.
    const prfOutput = new Uint8Array(await prfProvider.getPrfOutput(s));
    const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: s, info: new TextEncoder().encode('fize-device-lock-v1') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
    );
    return { kek, salt: s };
}

/**
 * 16 caracteres Crockford base32, un byte aleatorio por caracter (256 % 32 === 0: sin sesgo y sin repetir
 * el mismo byte para varios caracteres, que era lo que hacia el codigo anterior: 10 bytes para 16 huecos).
 */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % 32];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

function normalizeRecoveryInput(secret: string): string {
  return secret.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// Evento de bloqueo entre pestañas
// ---------------------------------------------------------------------------

interface LockMessage { type: 'lock'; at: number }

function isLockMessage(value: unknown): value is LockMessage {
  return !!value && typeof value === 'object' && (value as LockMessage).type === 'lock';
}

type LockListener = () => void;
const lockListeners = new Set<LockListener>();

let lockChannel: BroadcastChannel | null = null;
let lockChannelReady = false;
let storageListenerReady = false;

/**
 * Un bloqueo en otra pestaña bloquea ESTA: se tira la DEK que tuviera en memoria y se avisa a la pantalla
 * (el LockGate saca del DOM lo que estuviera a la vista). No se vuelve a publicar el aviso.
 */
function applyRemoteLock(): void {
  dropActiveDek();
  notifyLockListeners();
}

function channelFor(): BroadcastChannel | null {
  if (!lockChannelReady) {
    lockChannelReady = true;
    try {
      lockChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(LOCK_CHANNEL_NAME) : null;
    } catch {
      lockChannel = null;
    }
    lockChannel?.addEventListener('message', (event: MessageEvent) => {
      if (isLockMessage(event.data)) applyRemoteLock();
    });
  }
  return lockChannel;
}

function notifyLockListeners(): void {
  for (const listener of [...lockListeners]) {
    try {
      listener();
    } catch {
      /* un suscriptor roto no puede impedir que los demas se enteren */
    }
  }
}

function attachStorageListener(): void {
  if (storageListenerReady || typeof window === 'undefined') return;
  storageListenerReady = true;
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== LOCK_STORAGE_EVENT_KEY || !event.newValue) return;
    try {
      if (isLockMessage(JSON.parse(event.newValue))) applyRemoteLock();
    } catch {
      /* otro origen escribio la clave: se ignora */
    }
  });
}

/**
 * Avisa a las OTRAS pestañas de que el sobre cambio (se bloqueo, se activo o se desactivo la proteccion):
 * la DEK que tuvieran en memoria ya no sirve y hay que soltarla.
 *
 * Se publica por los DOS caminos: BroadcastChannel y la clave de `localStorage` (el evento `storage` solo lo
 * reciben las otras pestañas). Antes era uno u otro: si la pestaña ya habia abierto el canal (activar la
 * proteccion lo abre), el respaldo por `storage` nunca se escribia y una pestaña sin BroadcastChannel se
 * quedaba con la DEK vieja. Repetir el aviso es inofensivo: soltar la DEK dos veces es soltarla una.
 */
function publishLockMessage(): void {
  const message: LockMessage = { type: 'lock', at: Date.now() };
  const channel = channelFor();
  if (channel) {
    try {
      channel.postMessage(message);
    } catch {
      /* sin canal: queda el respaldo por almacenamiento */
    }
  }
  try {
    localStorage.setItem(LOCK_STORAGE_EVENT_KEY, JSON.stringify(message));
  } catch {
    /* sin almacenamiento: solo queda bloqueada esta pestaña */
  }
}

/**
 * Se suscribe a los bloqueos de OTRAS pestañas (BroadcastChannel y el respaldo `storage`). Devuelve la
 * funcion para desuscribirse. El listener de `storage` se registra una sola vez por pestaña.
 */
export function subscribeLockEvents(listener: LockListener): () => void {
  if (typeof window === 'undefined') return () => {};
  attachStorageListener();
  channelFor();
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}

export function lock(): void {
  dropActiveDek();
  publishLockMessage();
}

// ---------------------------------------------------------------------------
// Intentos fallidos (espera creciente) y exclusion entre intentos simultaneos
// ---------------------------------------------------------------------------

interface LockThrottle { failures: number; blockedUntil: number }

function backoffMs(policy: LockPolicy, over: number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, over));
}

async function assertNotThrottled(policy: LockPolicy): Promise<void> {
  const throttle = await readRaw<LockThrottle>(THROTTLE_KEY);
  if (!throttle || typeof throttle.failures !== 'number') return;
  const remaining = (throttle.blockedUntil ?? 0) - Date.now();
  if (throttle.failures >= policy.maxAttempts && remaining > 0) throw new LockoutError(remaining);
}

/**
 * Lee y escribe el control de intentos en UNA transaccion de `fize-local`. Dos pestañas a la vez hacian
 * read-modify-write y el contador se perdia: tres intentos simultaneos de tres pestañas dejaban
 * `failures: 1` y todas seguian llegando al KDF. La transaccion (IndexedDB serializa las de escritura del
 * mismo store, tambien entre conexiones) hace que cada intento sume exactamente uno.
 */
async function updateThrottle<T>(
  mutate: (current: LockThrottle | undefined) => { next: LockThrottle; result: T },
): Promise<T> {
  const database = await kvDb();
  const tx = database.transaction(KV_STORE, 'readwrite');
  const done = tx.done;
  done.catch(() => {
    /* el error se propaga por el await de `done` */
  });
  const store = tx.objectStore(KV_STORE);
  const current = (await store.get(THROTTLE_KEY)) as LockThrottle | undefined;
  const { next, result } = mutate(current);
  await store.put(next, THROTTLE_KEY);
  await done;
  return result;
}

interface AttemptClaim {
  allowed: boolean;
  /** Espera que queda por delante si el intento no esta permitido. */
  retryAfterMs: number;
  /** Numero de intento reservado (incluye este): el bloqueo se calcula sobre el. */
  failures: number;
}

/** Reserva un intento de forma ATOMICA: no llegan al KDF mas intentos que los que el contador cobra. */
async function claimAttempt(policy: LockPolicy): Promise<AttemptClaim> {
  return updateThrottle<AttemptClaim>((current) => {
    const failures = current?.failures ?? 0;
    const retryAfterMs = Math.max(0, (current?.blockedUntil ?? 0) - Date.now());
    if (failures >= policy.maxAttempts && retryAfterMs > 0) {
      return { next: current as LockThrottle, result: { allowed: false, retryAfterMs, failures } };
    }
    const reserved = failures + 1;
    // Pasado el limite, cada intento nuevo cuesta una espera, y se le cobra ANTES de tocar el KDF. Asi,
    // con N pestañas a la vez, el numero de intentos que llegan al KDF esta acotado por el contador (como
    // maximo uno mas que `maxAttempts`) en vez de crecer con el numero de pestañas.
    const blockedUntil =
      failures >= policy.maxAttempts
        ? Date.now() + backoffMs(policy, reserved - policy.maxAttempts)
        : (current?.blockedUntil ?? 0);
    return {
      next: { failures: reserved, blockedUntil },
      result: { allowed: true, retryAfterMs: 0, failures: reserved },
    };
  });
}

/** Anota el fallo del intento reservado (`failures`) y la espera creciente que le toca. */
async function registerFailure(policy: LockPolicy, failures: number): Promise<void> {
  await updateThrottle((current) => {
    const count = Math.max(current?.failures ?? 0, failures);
    const over = count - policy.maxAttempts;
    const blockedUntil = over >= 0 ? Date.now() + backoffMs(policy, over) : (current?.blockedUntil ?? 0);
    return { next: { failures: count, blockedUntil }, result: undefined };
  });
}

async function clearFailures(): Promise<void> {
  await deleteRaw(THROTTLE_KEY);
}

/** Un solo intento u operacion de bloqueo a la vez: sin esto, N intentos simultaneos son N oportunidades
 *  sin sumar el contador, y dos transiciones a la vez (activar/desactivar) se pisarian. */
let lockOpChain: Promise<unknown> = Promise.resolve();

function withLockMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = lockOpChain.then(fn, fn);
  lockOpChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// ---------------------------------------------------------------------------
// Activar / desactivar
// ---------------------------------------------------------------------------

export async function enableProtection(
  method: 'pin' | 'passkey',
  secret: string,
  prfProvider?: PasskeyPrfProvider,
  options?: LockOptions,
): Promise<string> {
  return withLockMutex(() => enableProtectionLocked(method, secret, prfProvider, options));
}

async function enableProtectionLocked(
  method: 'pin' | 'passkey',
  secret: string,
  prfProvider?: PasskeyPrfProvider,
  options?: LockOptions,
): Promise<string> {
  const policy = policyOf(options);
  const state = await getLockState();
  if (state !== 'off') throw new Error('La protección ya está activada');

  // Resto de un intento que no llego a escribir el sobre: como el sobre se escribe ANTES de cifrar nada,
  // sin sobre no hay datos cifrados y el marcador es basura.
  if (await readLockTransition()) await clearLockTransition();
  // Sobre nuevo, presupuesto de intentos nuevo: sin esto un contador viejo (de un equipo que estuvo
  // bloqueado antes) haria saltar la espera antes de tiempo.
  await clearFailures();

  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
     await navigator.storage.persist();
  }

  // `extractable` SOLO para poder envolverla (ver cabecera). La llave que queda en memoria se obtiene del
  // sobre ya escrito, con `extractable:false`.
  const wrappableDek = await crypto.subtle.generateKey(DEK_PARAMS, true, ['encrypt', 'decrypt']);

  let mainKek: CryptoKey;
  let mainSalt: Bytes;
  if (method === 'pin') {
      const derived = await derivePinKek(secret, policy.iterations);
      mainKek = derived.kek;
      mainSalt = derived.salt;
  } else {
      if (!prfProvider) throw new Error('Passkey PRF provider no proveído');
      const derived = await derivePasskeyKek(prfProvider);
      mainKek = derived.kek;
      mainSalt = derived.salt;
  }

  const wrappedDek = await wrapDek(wrappableDek, mainKek, mainSalt);

  const recoveryCodeStr = generateRecoveryCode();
  const recoveryRaw = normalizeRecoveryInput(recoveryCodeStr);
  const recSalt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
  const recoveryKek = await deriveRecoveryKek(recoveryRaw, policy.iterations, recSalt);
  const wrappedRecovery = await wrapDek(wrappableDek, recoveryKek, recSalt);

  const envelope: LockEnvelope = {
    method,
    wrappedDek,
    wrappedRecovery,
    iterations: policy.iterations,
    gen: newGeneration(),
    transitionNonce: newTransitionNonce(),
  };

  // La DEK de ESTA pestaña se saca del sobre ANTES de escribir nada: el marcador de activacion va firmado
  // con ella (y con el nonce del sobre), igual que el de desactivacion.
  const sessionDek = await unwrapDek(wrappedDek, mainKek, false);

  // Marcador ANTES del sobre: si la pestaña muere a mitad de la migracion, al abrir otra vez el estado es
  // 'locked' (hay sobre y no hay DEK) y el primer desbloqueo reanuda desde la ultima fase marcada.
  //
  // Va FIRMADO: sin la firma de la DEK, un `{phase:'locking'}` plantado a mano (devtools, perfil
  // restaurado, copia vieja) obligaba al desbloqueo a "reanudar" y a cifrar con la DEK buena lo que
  // encontrara en claro, blanqueando texto plano inyectado (identity, filas) como si fuera legitimo.
  // La DEK sale del PIN que acaba de escribir el usuario, asi que el corte legitimo sigue reanudandose.
  await writeLockTransition(
    { v: 1, phase: 'locking', done: [], startedAt: new Date().toISOString(), nonce: envelope.transitionNonce },
    sessionDek,
  );
  await writeRaw(ENVELOPE_KEY, envelope);
  // Las otras pestañas tienen la DEK del sobre ANTERIOR (o ninguna): se avisa en cuanto hay sobre nuevo
  // para que la suelten y no escriban con una llave que ya no abre nada.
  publishLockMessage();

  activeDek = sessionDek;
  activeDekGeneration = envelopeGeneration(envelope);
  currentMethod = method;
  // Mientras se cifra lo que ya habia, nadie lee: quedaria texto plano a la vista a mitad de camino.
  isLockedState = true;

  await withStorageGate(async () => {
    await runLockTransition('locking', activeDek!);
    const pending = await findPlaintextLeftovers();
    if (pending.length) {
      throw new Error(`No se pudo cifrar todo lo que ya había (${pending.join(', ')}). Vuelve a desbloquear para reintentarlo.`);
    }
  });

  // El nonce del sobre rota AHORA (y el marcador se borra en la misma transaccion): asi el marcador que un
  // atacante haya podido copiar durante la activacion deja de autorizar la transicion vigente.
  await finishLockingTransition(envelope);
  isLockedState = false;
  return recoveryCodeStr;
}

export async function unlock(
  method: 'pin' | 'passkey' | 'recovery',
  secret: string,
  prfProvider?: PasskeyPrfProvider,
  options?: LockOptions,
): Promise<void> {
  const policy = policyOf(options);
  await assertNotThrottled(policy);
  return withLockMutex(async () => {
    // El intento se reserva DENTRO de una transaccion de `fize-local`: ni se pierde un fallo con varias
    // pestañas a la vez, ni llegan al KDF mas intentos que los que el contador cobra.
    const claim = await claimAttempt(policy);
    if (!claim.allowed) throw new LockoutError(claim.retryAfterMs);
    try {
      const envelope = await readEnvelope();
      if (!isEnvelope(envelope)) {
        await clearLockTransition();
        throw new Error('Protección no activada');
      }
      const dek = await dekFromEnvelope(envelope, method, secret, prfProvider);

      // Reanuda la migracion que quedo a medias (pestaña cerrada al activar la proteccion), pero SOLO si
      // el marcador lo firmo la DEK de este sobre y pertenece a su transicion vigente. Un marcador sin
      // firma (o con firma invalida) no autoriza nada: no se cifra lo que este en claro —seria blanquear
      // texto plano inyectado como `identity.privateJwk`— ni se acepta como dato legitimo (sigue saliendo
      // `PlaintextDataError`). El marcador invalido se descarta para no volver a mirarlo.
      const pending = await readLockTransition();
      const resumable = pending ? await markerAuthorizesTransition(pending, dek, envelope) : false;
      if (pending?.phase === 'locking' && !resumable) await clearLockTransition();
      if (pending?.phase === 'locking' && resumable) {
        activeDek = dek;
        activeDekGeneration = envelopeGeneration(envelope);
        isLockedState = true;
        await withStorageGate(async () => {
          await runLockTransition('locking', dek);
          const missing = await findPlaintextLeftovers();
          if (missing.length) {
            throw new Error(`No se pudo cifrar todo lo que ya había (${missing.join(', ')}).`);
          }
        });
        // Reanudacion terminada: rota el nonce del sobre y borra el marcador juntos, para que la copia que
        // el atacante guardo cuando el corte no vuelva a autorizar nada (ver `finishLockingTransition`).
        await finishLockingTransition(envelope);
      } else if (pending?.phase === 'unlocking' && resumable) {
        // La pestaña que desactivaba murio a mitad. El marcador esta firmado por esta DEK y pertenece a la
        // transicion vigente del sobre: se TERMINA la desactivacion (el usuario ya lo habia pedido) en vez
        // de dejar el equipo a medias. Un marcador que no se puede autenticar o que es de un intento
        // anterior no se toca (ver `completeDisable`): no se reanuda ni se acepta texto plano por el.
        try {
          await completeDisable(dek);
          await clearFailures();
          return;
        } catch {
          // Un resto cifrado dañado o la cuota: se sigue con el desbloqueo normal (la proteccion queda
          // activada y el usuario puede reintentar "Desactivar", que vuelve a mirarlo todo).
        }
      }

      activeDek = dek;
      activeDekGeneration = envelopeGeneration(envelope);
      isLockedState = false;
      currentMethod = method;
      await clearFailures();
    } catch (err) {
      if (err instanceof LockedError) await registerFailure(policy, claim.failures);
      throw err;
    }
  });
}

async function dekFromEnvelope(
  envelope: LockEnvelope,
  method: 'pin' | 'passkey' | 'recovery',
  secret: string,
  prfProvider?: PasskeyPrfProvider,
): Promise<CryptoKey> {
  const iterations = typeof envelope.iterations === 'number' ? envelope.iterations : PRODUCTION_KDF_ITERATIONS;
  if (method === 'recovery') {
     const { salt } = unpackWrappedKey(envelope.wrappedRecovery);
     const recoveryKek = await deriveRecoveryKek(normalizeRecoveryInput(secret), iterations, salt);
     return unwrapDek(envelope.wrappedRecovery, recoveryKek, false);
  }
  if (method === 'pin') {
     const { salt } = unpackWrappedKey(envelope.wrappedDek);
     const { kek } = await derivePinKek(secret, iterations, salt);
     return unwrapDek(envelope.wrappedDek, kek, false);
  }
  if (!prfProvider) throw new Error('Passkey PRF provider requerido');
  const { salt } = unpackWrappedKey(envelope.wrappedDek);
  const { kek } = await derivePasskeyKek(prfProvider, salt);
  return unwrapDek(envelope.wrappedDek, kek, false);
}

export async function changePin(oldPin: string, newPin: string, options?: LockOptions): Promise<void> {
  return withLockMutex(() => changePinLocked(oldPin, newPin, options));
}

async function changePinLocked(oldPin: string, newPin: string, options?: LockOptions): Promise<void> {
   const policy = policyOf(options);
   const envelope = await readEnvelope();
   if (!isEnvelope(envelope)) throw new Error('Protección no activada');
   if (!activeDek) throw new LockedError();
   if (envelope.method !== 'pin') throw new Error('Solo se puede cambiar PIN si el método actual es PIN');
   await assertNotThrottled(policy);

   const iterations = typeof envelope.iterations === 'number' ? envelope.iterations : PRODUCTION_KDF_ITERATIONS;
   const { salt: mainSalt } = unpackWrappedKey(envelope.wrappedDek);

   let rewrappable: CryptoKey;
   try {
     const { kek: oldKek } = await derivePinKek(oldPin, iterations, mainSalt);
     // Copia extractable SOLO para volver a envolver; no se exporta a JavaScript en ningun momento.
     rewrappable = await unwrapDek(envelope.wrappedDek, oldKek, true);
   } catch (err) {
     if (err instanceof LockedError) {
       await registerFailure(policy, ((await readRaw<LockThrottle>(THROTTLE_KEY))?.failures ?? 0) + 1);
     }
     throw err;
   }
   await clearFailures();

   const { kek: newKek, salt: newSalt } = await derivePinKek(newPin, iterations);
   envelope.wrappedDek = await wrapDek(rewrappable, newKek, newSalt);
   await withStorageGate(async () => {
     await writeRaw(ENVELOPE_KEY, envelope);
   });
   activeDek = await unwrapDek(envelope.wrappedDek, newKek, false);
   // El sobre sigue siendo el mismo (`gen` no cambia): la DEK de memoria sigue siendo la del sobre.
   activeDekGeneration = envelopeGeneration(envelope);
}

/**
 * Desactiva la proteccion. Primero DESCRIFRA todo y COMPRUEBA que no quede nada cifrado; solo entonces
 * borra el sobre y la DEK. Si se borrara antes, las filas quedarian con `{__enc}` sin llave y activar la
 * proteccion otra vez perderia los datos (la DEK nueva no abre lo que cifro la vieja).
 */
export async function disableProtection(): Promise<void> {
  return withLockMutex(disableProtectionLocked);
}

/** Marcador de desactivacion sin fases hechas (el estado inicial honesto de un reintento). */
function freshUnlockingMarker(nonce: string): Parameters<typeof writeLockTransition>[0] {
  return { v: 1, phase: 'unlocking', done: [], startedAt: new Date().toISOString(), nonce };
}

/**
 * Arranca un intento de desactivacion NUEVO: rota el nonce del sobre y escribe el marcador sin fases hechas
 * firmado con la DEK. El nonce del sobre va dentro del marcador (y de lo que se firma), asi que un marcador
 * capturado de un intento anterior deja de autorizar nada en cuanto el sobre rota (ver
 * `markerAuthorizesTransition`).
 */
async function writeFreshUnlockingMarker(dek: CryptoKey, envelope: LockEnvelope): Promise<void> {
  const nonce = newTransitionNonce();
  await writeRaw(ENVELOPE_KEY, { ...envelope, transitionNonce: nonce });
  await writeLockTransition(freshUnlockingMarker(nonce), dek);
}

/**
 * Cierra la transicion `locking` que acaba de completar: ROTA el nonce de transicion del sobre y borra el
 * marcador en la MISMA transaccion de `fize-local`.
 *
 * Por que rotar: el nonce se quedaba quieto hasta la siguiente desactivacion, asi que un marcador `locking`
 * firmado CAPTURADO a mitad de la activacion seguia perteneciendo a la transicion vigente del sobre. Con el
 * equipo bloqueado, plantar esa copia y desbloquear hacia que el desbloqueo "reanudase" la activacion y
 * cifrase con la DEK buena texto plano inyectado (`identity.privateJwk`, filas) hasta blanquearlo como dato
 * legitimo; si el `done` capturado se saltaba la fase `local`, el desbloqueo ademas fallaba en CADA intento
 * (resto en claro que nadie vuelve a mirar) y el equipo quedaba sin poder desbloquearse ni con el codigo.
 *
 * Por que en UNA transaccion: si el proceso muere entre la rotacion y el borrado, el marcador que quede ya
 * no pertenece a la transicion vigente —se descarta sin reanudar en el proximo desbloqueo— y los datos ya
 * estan cifrados (este cierre solo corre despues de comprobar que no queda texto plano), asi que el equipo
 * siempre queda con una salida legitima. Al reves —borrar sin rotar— es justo el agujero: el marcador
 * capturado vuelve a autorizar. Si la transaccion no llega a confirmar, no cambia nada: el marcador sigue
 * vigente y la activacion se reanuda como si el corte hubiera sido antes.
 */
async function finishLockingTransition(envelope: LockEnvelope): Promise<void> {
  const database = await kvDb();
  const tx = database.transaction(KV_STORE, 'readwrite');
  const done = tx.done;
  done.catch(() => {
    /* el error se propaga por el await de `done` */
  });
  const store = tx.objectStore(KV_STORE);
  const current = (await store.get(ENVELOPE_KEY)) as unknown;
  // Si otra pestaña ya cambio el sobre, su nonce no es asunto de esta transicion: solo se rota el de la
  // generacion que acaba de terminar (el marcador, que si es nuestro, se borra igual).
  if (isEnvelope(current) && envelopeGeneration(current) === envelopeGeneration(envelope)) {
    await store.put({ ...current, transitionNonce: newTransitionNonce() }, ENVELOPE_KEY);
  }
  await store.delete(LOCK_TRANSITION_KEY);
  await done;
  endLocalTransition();
}

/**
 * Completa la desactivacion con una DEK concreta: la usan `disableProtection` y el desbloqueo que reanuda
 * una desactivacion que quedo a medias (pestaña cerrada, equipo apagado).
 */
async function completeDisable(dek: CryptoKey): Promise<void> {
   await withStorageGate(async () => {
     const envelope = await readEnvelope();
     if (!isEnvelope(envelope)) throw new Error('Protección no activada');
     const existing = await readLockTransition();
     const resumable =
       existing !== null &&
       existing.phase === 'unlocking' &&
       (await markerAuthorizesTransition(existing, dek, envelope));
     if (!resumable) {
       // El marcador se escribe SIN mirar el que hubiera: uno sin firma valida o de una transicion anterior
       // (plantado, restaurado de una copia vieja, capturado y repetido) no puede decidir que fases ya
       // estan hechas. El `done` se rehace desde cero, cada fase es idempotente y el nonce del sobre rota.
       await writeFreshUnlockingMarker(dek, envelope);
     }
     try {
       await runLockTransition('unlocking', dek);
       const leftovers = await findEncryptedLeftovers();
       if (leftovers.length) {
         throw new Error(
           `No se pudo descifrar todo (${leftovers.join(', ')}). La protección sigue activada; vuelve a intentarlo.`,
         );
       }
     } catch (err) {
       // El marcador no puede quedarse diciendo que fases que no se completaron ya estan hechas: si no,
       // cada reintento se las saltaria y el equipo se quedaria sin poder desactivar la proteccion. Ademas
       // el intento que acaba de fallar agota su autorizacion: el reintento escribe un nonce nuevo.
       try {
         await writeFreshUnlockingMarker(dek, envelope);
       } catch {
         /* manda el error original */
       }
       throw err;
     }
     await deleteRaw(ENVELOPE_KEY);
     await deleteRaw(THROTTLE_KEY);
     await clearLockTransition();
   });
   // Las otras pestañas tienen la DEK del sobre que acaba de desaparecer: se avisa para que la suelten.
   publishLockMessage();
   dropActiveDek();
   isLockedState = false;
}

async function disableProtectionLocked(): Promise<void> {
   const envelope = await readEnvelope();
   if (!isEnvelope(envelope)) throw new Error('Protección no activada');
   // `getLockState` suelta la DEK si es de un sobre que ya no es el vigente (otra pestaña desactivo y
   // reactivo): con la llave vieja no se descifra nada y se quedaria el equipo bloqueado a medias.
   if ((await getLockState()) !== 'unlocked') throw new LockedError();
   const dek = activeDek;
   if (!dek) throw new LockedError();
   await completeDisable(dek);
}

/** SOLO PARA TESTS. */
export function resetDeviceLockForTests(): void {
  activeDek = null;
  activeDekGeneration = null;
  isLockedState = false;
  currentMethod = null;
  lockOpChain = Promise.resolve();
  lockListeners.clear();
  if (lockChannel) {
    try { lockChannel.close(); } catch { /* ya cerrado */ }
  }
  lockChannel = null;
  lockChannelReady = false;
  storageListenerReady = false;
}
