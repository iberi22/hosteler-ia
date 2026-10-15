// deviceLock.ts — Device Lock mechanism and state management.
import { getLocal, setLocal, deleteLocal } from './localDb';

export class LockedError extends Error {
  constructor(message = 'La aplicación está bloqueada') {
    super(message);
    this.name = 'LockedError';
  }
}

export type LockState = 'off' | 'locked' | 'unlocked';

export interface LockEnvelope {
  method: 'pin' | 'passkey';
  wrappedDek: string;
  wrappedRecovery: string;
}

export interface PasskeyPrfProvider {
    getPrfOutput(salt: Uint8Array): Promise<Uint8Array>;
}

let activeDek: CryptoKey | null = null;
let currentMethod: 'pin' | 'passkey' | 'recovery' | null = null;
let isLockedState = false;

export async function getLockState(): Promise<LockState> {
  const env = await getLocal<LockEnvelope>('lockEnvelope');
  if (!env) return 'off';
  if (isLockedState || !activeDek) return 'locked';
  return 'unlocked';
}

export function getActiveDek(): CryptoKey | null {
  return activeDek;
}

export function lock(): void {
  activeDek = null;
  currentMethod = null;
  isLockedState = true;
}

export async function wrapKey(dekToWrap: CryptoKey, kek: CryptoKey): Promise<string> {
   const raw = await crypto.subtle.exportKey('raw', dekToWrap);
   const iv = crypto.getRandomValues(new Uint8Array(12));
   const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);

   const b64 = (buf: ArrayBuffer) => {
       const bin = Array.from((new Uint8Array(buf as any) as any) as any as Iterable<number>, (byte) => String.fromCharCode(byte)).join('');
       return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
   };

   return `v1.${b64(iv as any)}.${b64(ct as any)}`;
}

export async function unwrapKey(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
   if (!wrapped) throw new Error('Invalid wrapped key format (empty)');
   const parts = wrapped.split('.');
   if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Invalid wrapped key format');

   const fromB64 = (str: string) => {
       let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
       while (b64.length % 4) b64 += '=';
       const bin = atob(b64);
       return (Uint8Array.from(bin, (m) => m.codePointAt(0)!) as any);
   };

   const iv = fromB64(parts[1]);
   const ct = fromB64(parts[2]);

   try {
     const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ct);
     return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', true, ['encrypt', 'decrypt']);
   } catch (e) {
     throw new LockedError('Clave incorrecta');
   }
}

async function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// Internal: Derives a KEK from a PIN
async function derivePinKek(pin: string, salt?: Uint8Array): Promise<{ kek: CryptoKey, salt: Uint8Array }> {
    const s = salt || crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin) as BufferSource, 'PBKDF2', false, ['deriveKey']);
    const isTest = typeof process !== 'undefined' && process.env.VITEST;
    const iterations = isTest ? 10 : 600000;
    const kek = await crypto.subtle.deriveKey( /* @ts-ignore */
        { name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
    return { kek, salt: s };
}

// Internal: Derives a KEK from a Passkey PRF output
async function derivePasskeyKek(prfProvider: PasskeyPrfProvider, salt?: Uint8Array): Promise<{ kek: CryptoKey, salt: Uint8Array }> {
    const s = salt || crypto.getRandomValues(new Uint8Array(16));
    const prfOutput = await prfProvider.getPrfOutput(s);
    const base = await crypto.subtle.importKey('raw', prfOutput as BufferSource, 'HKDF', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey( /* @ts-ignore */
        { name: 'HKDF', hash: 'SHA-256', salt: s, info: new TextEncoder().encode('fize-device-lock-v1') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
    return { kek, salt: s };
}

export async function enableProtection(method: 'pin' | 'passkey', secret: string, prfProvider?: PasskeyPrfProvider): Promise<string> {
  const state = await getLockState();
  if (state !== 'off') throw new Error('La protección ya está activada');

  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
     await navigator.storage.persist();
  }

  const dek = await generateDek();

  let mainKek: CryptoKey;
  let mainSalt: Uint8Array;
  if (method === 'pin') {
      const derived = await derivePinKek(secret);
      mainKek = derived.kek;
      mainSalt = derived.salt;
  } else {
      if (!prfProvider) throw new Error('Passkey PRF provider no proveído');
      const derived = await derivePasskeyKek(prfProvider);
      mainKek = derived.kek;
      mainSalt = derived.salt;
  }

  const wrappedDekCore = await wrapKey(dek, mainKek);

  const b64 = (buf: ArrayBuffer) => {
      const bin = Array.from((new Uint8Array(buf as any) as any) as any as Iterable<number>, (byte) => String.fromCharCode(byte)).join('');
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  // Save as v1.salt.iv.ct
  const wrappedDek = `v1.${b64(mainSalt as any)}.${wrappedDekCore.substring(3)}`;

  const codeBuf = crypto.getRandomValues(new Uint8Array(10));
  const codeAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let rawCode = '';
  for (let i = 0; i < 16; i++) rawCode += codeAlphabet[codeBuf[i % 10] % 32];
  const recoveryCodeStr = `${rawCode.slice(0,4)}-${rawCode.slice(4,8)}-${rawCode.slice(8,12)}-${rawCode.slice(12,16)}`;

  const recSalt = crypto.getRandomValues(new Uint8Array(16));
  const recBase = await crypto.subtle.importKey('raw', new TextEncoder().encode(rawCode) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  const isTest = typeof process !== 'undefined' && process.env.VITEST;
  const recoveryKek = await crypto.subtle.deriveKey( /* @ts-ignore */
        { name: 'PBKDF2', hash: 'SHA-256', salt: recSalt, iterations: isTest ? 10 : 600000 },
        recBase,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
  );

  const wrappedRecoveryCore = await wrapKey(dek, recoveryKek);
  const wrappedRecovery = `v1.${b64(recSalt as any)}.${wrappedRecoveryCore.substring(3)}`;

  await setLocal('lockEnvelope', {
    method,
    wrappedDek,
    wrappedRecovery
  } as LockEnvelope);

  activeDek = dek;
  isLockedState = false;
  currentMethod = method;

  return recoveryCodeStr;
}

export async function unlock(method: 'pin' | 'passkey' | 'recovery', secret: string, prfProvider?: PasskeyPrfProvider): Promise<void> {
  const env = await getLocal<LockEnvelope>('lockEnvelope');
  if (!env) throw new Error('Protección no activada');

  const fromB64 = (str: string) => {
       let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
       while (b64.length % 4) b64 += '=';
       const bin = atob(b64);
       return (Uint8Array.from(bin, (m) => m.codePointAt(0)!) as any);
  };

  if (method === 'recovery') {
     const parts = env.wrappedRecovery.split('.');
     if (parts.length !== 4) throw new Error('Formato de recuperación inválido');
     const recSalt = fromB64(parts[1]);
     const rawCode = secret.replace(/[^0-9A-Za-z]/g, '').toUpperCase();

     const isTest = typeof process !== 'undefined' && process.env.VITEST;
     const recBase = await crypto.subtle.importKey('raw', new TextEncoder().encode(rawCode) as BufferSource, 'PBKDF2', false, ['deriveKey']);
     const recoveryKek = await crypto.subtle.deriveKey( /* @ts-ignore */
            { name: 'PBKDF2', hash: 'SHA-256', salt: recSalt, iterations: isTest ? 10 : 600000 },
            recBase,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
     );

     const wrappedKey = `v1.${parts[2]}.${parts[3]}`;
     activeDek = await unwrapKey(wrappedKey, recoveryKek);
  } else if (method === 'pin') {
     const parts = env.wrappedDek.split('.');
     if (parts.length !== 4) throw new Error('Formato de pin inválido');
     const mainSalt = fromB64(parts[1]);
     const { kek } = await derivePinKek(secret, mainSalt);
     const wrappedKey = `v1.${parts[2]}.${parts[3]}`;
     try {
       activeDek = await unwrapKey(wrappedKey, kek);
     } catch (e) {
       throw new LockedError('Clave incorrecta');
     }
  } else if (method === 'passkey') {
     if (!prfProvider) throw new Error('Passkey PRF provider requerido');
     const parts = env.wrappedDek.split('.');
     if (parts.length !== 4) throw new Error('Formato de passkey inválido');
     const mainSalt = fromB64(parts[1]);
     const { kek } = await derivePasskeyKek(prfProvider, mainSalt);
     const wrappedKey = `v1.${parts[2]}.${parts[3]}`;
     try {
       activeDek = await unwrapKey(wrappedKey, kek);
     } catch (e) {
       throw new LockedError('Clave incorrecta');
     }
  }

  isLockedState = false;
  currentMethod = method;
}

export async function changePin(oldPin: string, newPin: string): Promise<void> {
   const env = await getLocal<LockEnvelope>('lockEnvelope');
   if (!env) throw new Error('Protección no activada');
   if (!activeDek) throw new LockedError();

   if (env.method !== 'pin') throw new Error('Solo se puede cambiar PIN si el método actual es PIN');

   const fromB64 = (str: string) => {
       let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
       while (b64.length % 4) b64 += '=';
       const bin = atob(b64);
       return (Uint8Array.from(bin, (m) => m.codePointAt(0)!) as any);
   };

   const parts = env.wrappedDek.split('.');
   if (parts.length !== 4) throw new Error('Formato de pin inválido');
   const mainSalt = fromB64(parts[1]);
   const { kek: oldKek } = await derivePinKek(oldPin, mainSalt);
   const wrappedKey = `v1.${parts[2]}.${parts[3]}`;
   await unwrapKey(wrappedKey, oldKek);

   const { kek: newKek, salt: newSalt } = await derivePinKek(newPin);
   const wrappedDekCore = await wrapKey(activeDek, newKek);

   const b64 = (buf: ArrayBuffer) => {
       const bin = Array.from((new Uint8Array(buf as any) as any) as any as Iterable<number>, (byte) => String.fromCharCode(byte)).join('');
       return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
   };
   env.wrappedDek = `v1.${b64(newSalt as any)}.${wrappedDekCore.substring(3)}`;

   await setLocal('lockEnvelope', env);
}





export async function disableProtection(): Promise<void> {
   if (!activeDek) throw new LockedError();

   await deleteLocal('lockEnvelope');
   activeDek = null;
   isLockedState = false;
   currentMethod = null;
}

export function resetDeviceLockForTests() { activeDek = null; isLockedState = false; currentMethod = null; }
