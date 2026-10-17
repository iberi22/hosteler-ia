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
  findPlaintextLeftovers,
  findEncryptedLeftovers,
  readLockTransition,
  runLockTransition,
  writeLockTransition,
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
  if (isLockedState || !activeDek) return 'locked';
  return 'unlocked';
}

export function getActiveDek(): CryptoKey | null {
  return activeDek;
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
  activeDek = null;
  currentMethod = null;
  isLockedState = true;
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

/** Avisa a las OTRAS pestañas de que este equipo quedo bloqueado. */
function publishLockMessage(): void {
  const message: LockMessage = { type: 'lock', at: Date.now() };
  const channel = channelFor();
  if (channel) {
    try {
      channel.postMessage(message);
      return;
    } catch {
      /* se cae al evento storage */
    }
  }
  try {
    localStorage.setItem(LOCK_STORAGE_EVENT_KEY, JSON.stringify(message));
  } catch {
    /* sin almacenamiento: solo queda bloqueada esta pestaña */
  }
}

/**
 * Se suscribe a los bloqueos de OTRAS pestañas (BroadcastChannel y, si no hay, `storage`). Devuelve la
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
  activeDek = null;
  currentMethod = null;
  isLockedState = true;
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

async function registerFailure(policy: LockPolicy): Promise<void> {
  const previous = await readRaw<LockThrottle>(THROTTLE_KEY);
  const failures = (previous?.failures ?? 0) + 1;
  const over = failures - policy.maxAttempts;
  const blockedUntil = over >= 0 ? Date.now() + backoffMs(policy, over) : 0;
  await writeRaw(THROTTLE_KEY, { failures, blockedUntil } satisfies LockThrottle);
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

  const envelope: LockEnvelope = { method, wrappedDek, wrappedRecovery, iterations: policy.iterations };

  // Marcador ANTES del sobre: si la pestaña muere a mitad de la migracion, al abrir otra vez el estado es
  // 'locked' (hay sobre y no hay DEK) y el primer desbloqueo reanuda desde la ultima fase marcada.
  await writeLockTransition({ v: 1, phase: 'locking', done: [], startedAt: new Date().toISOString() });
  await writeRaw(ENVELOPE_KEY, envelope);

  activeDek = await unwrapDek(wrappedDek, mainKek, false);
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

  await clearLockTransition();
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
    // Otro intento pudo gastar los ultimos intentos mientras este esperaba el turno.
    await assertNotThrottled(policy);
    try {
      const envelope = await readEnvelope();
      if (!isEnvelope(envelope)) {
        await clearLockTransition();
        throw new Error('Protección no activada');
      }
      const dek = await dekFromEnvelope(envelope, method, secret, prfProvider);

      // Reanuda la migracion que quedo a medias (pestaña cerrada al activar la proteccion).
      const pending = await readLockTransition();
      if (pending?.phase === 'locking') {
        activeDek = dek;
        isLockedState = true;
        await withStorageGate(async () => {
          await runLockTransition('locking', dek);
          const missing = await findPlaintextLeftovers();
          if (missing.length) {
            throw new Error(`No se pudo cifrar todo lo que ya había (${missing.join(', ')}).`);
          }
        });
        await clearLockTransition();
      }

      activeDek = dek;
      isLockedState = false;
      currentMethod = method;
      await clearFailures();
    } catch (err) {
      if (err instanceof LockedError) await registerFailure(policy);
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
     if (err instanceof LockedError) await registerFailure(policy);
     throw err;
   }
   await clearFailures();

   const { kek: newKek, salt: newSalt } = await derivePinKek(newPin, iterations);
   envelope.wrappedDek = await wrapDek(rewrappable, newKek, newSalt);
   await withStorageGate(async () => {
     await writeRaw(ENVELOPE_KEY, envelope);
   });
   activeDek = await unwrapDek(envelope.wrappedDek, newKek, false);
}

/**
 * Desactiva la proteccion. Primero DESCRIFRA todo y COMPRUEBA que no quede nada cifrado; solo entonces
 * borra el sobre y la DEK. Si se borrara antes, las filas quedarian con `{__enc}` sin llave y activar la
 * proteccion otra vez perderia los datos.
 */
export async function disableProtection(): Promise<void> {
  return withLockMutex(disableProtectionLocked);
}

async function disableProtectionLocked(): Promise<void> {
   const dek = activeDek;
   if (!dek) throw new LockedError();
   const envelope = await readEnvelope();
   if (!isEnvelope(envelope)) throw new Error('Protección no activada');

   await withStorageGate(async () => {
     await writeLockTransition({ v: 1, phase: 'unlocking', done: [], startedAt: new Date().toISOString() });
     await runLockTransition('unlocking', dek);
     const leftovers = await findEncryptedLeftovers();
     if (leftovers.length) {
       throw new Error(
         `No se pudo descifrar todo (${leftovers.join(', ')}). La protección sigue activada; vuelve a intentarlo.`,
       );
     }
     await deleteRaw(ENVELOPE_KEY);
     await deleteRaw(THROTTLE_KEY);
     await clearLockTransition();
   });

   activeDek = null;
   isLockedState = false;
   currentMethod = null;
}

/** SOLO PARA TESTS. */
export function resetDeviceLockForTests(): void {
  activeDek = null;
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
