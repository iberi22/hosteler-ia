// backupCrypto.ts — codigo de recuperacion y sobre cifrado de las copias (docs/producto/NODO-LOCAL.md §2.3).
//
// Codigo: 16 caracteres Crockford base32 (80 bits) en 4 grupos, generado en el equipo y mostrado una vez.
// Llave: PBKDF2-SHA256 (600.000 iteraciones) del codigo + sal aleatoria → 512 bits: los primeros 256 son la
// llave AES-GCM-256 y los otros 256 solo sirven para `check`, que distingue "codigo errado" de "archivo
// alterado" (AES-GCM por si solo da el mismo error en los dos casos). SWAL nunca conoce el codigo.
//
// Sobre `fize-backup-enc/v1` = { format, kdf, salt, iv, check, ciphertext }; el interior es un
// `swal-backup/v1` (formato de @swal/ui/backup). Solo WebCrypto: corre igual en navegador y en Node.

export const ENC_FORMAT = 'fize-backup-enc/v1' as const;
export const BACKUP_FORMAT = 'swal-backup/v1' as const;
export const KDF_ITERATIONS = 600_000;
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;
/** Tope al leer un archivo (50 MB, igual que @swal/ui/backup). */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export interface PlainBackup {
  format: typeof BACKUP_FORMAT;
  appId: string;
  createdAt: string;
  schemaVersion: number;
  stores: Record<string, unknown[]>;
  /** Extras del nodo local (llave del restaurante, avance del onboarding, ajustes). */
  local?: Record<string, unknown>;
}

export interface EncryptedBackup {
  format: typeof ENC_FORMAT;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number };
  salt: string;
  iv: string;
  check: string;
  ciphertext: string;
}

export type BackupErrorKind = 'formato' | 'codigo' | 'alterado' | 'otra-instancia' | 'conflicto' | 'en-curso';

const MESSAGES: Record<BackupErrorKind, string> = {
  formato: 'Este archivo no es una copia de Fize o está incompleto.',
  codigo: 'El código de recuperación no es correcto. Revísalo e inténtalo de nuevo; no se cambió nada en este equipo.',
  alterado: 'El archivo de la copia está dañado o fue modificado, así que no se puede abrir. No se cambió nada en este equipo.',
  'otra-instancia':
    'Esta copia es de otro local. Para usarla en este equipo tienes que confirmar que reemplazas tu local actual. No se cambió nada en este equipo.',
  conflicto:
    'La copia trae registros que chocan con otro local guardado en este equipo, así que no se puede restaurar. No se cambió nada en este equipo.',
  'en-curso':
    'Otra pestaña de Fize en este equipo está restaurando una copia. Espera a que termine e inténtalo otra vez; no se cambió nada en este equipo.',
};

export class BackupError extends Error {
  readonly kind: BackupErrorKind;
  constructor(kind: BackupErrorKind, message = MESSAGES[kind]) {
    super(message);
    this.name = 'BackupError';
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Codigo de recuperacion
// ---------------------------------------------------------------------------

/** 16 caracteres Crockford aleatorios (rechazo de sesgo: 256 % 32 = 0, cada byte da 5 bits limpios). */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b & 31];
  return formatRecoveryCode(out);
}

/** Mayusculas, sin guiones ni espacios; I/L→1 y O→0 como manda Crockford. Null si no es un codigo valido. */
export function normalizeRecoveryCode(raw: string): string | null {
  const s = raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** `XXXX-XXXX-XXXX-XXXX`. */
export function formatRecoveryCode(code: string): string {
  const s = normalizeRecoveryCode(code) ?? code;
  return s.match(/.{1,4}/g)?.join('-') ?? s;
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Cifrado
// ---------------------------------------------------------------------------

async function deriveKeys(code: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 512),
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const check = toB64(new Uint8Array(await crypto.subtle.digest('SHA-256', bits.slice(32))).slice(0, 16));
  return { key, check };
}

/** Datos asociados: amarran el texto cifrado a su cabecera (formato, KDF, sal). */
function aad(env: Pick<EncryptedBackup, 'format' | 'kdf' | 'salt'>): Uint8Array<ArrayBuffer> {
  const text = `${env.format}|${env.kdf.name}|${env.kdf.hash}|${env.kdf.iterations}|${env.salt}`;
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

export async function encryptBackup(backup: PlainBackup, code: string): Promise<EncryptedBackup> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new BackupError('codigo', 'El código de recuperación debe tener 16 caracteres (4 grupos de 4).');
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const header = {
    format: ENC_FORMAT,
    kdf: { name: 'PBKDF2' as const, hash: 'SHA-256' as const, iterations: KDF_ITERATIONS },
    salt: toB64(salt),
  };
  const { key, check } = await deriveKeys(normalized, salt, KDF_ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(backup));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header) }, key, plain);
  return { ...header, iv: toB64(iv), check, ciphertext: toB64(new Uint8Array(ct)) };
}

function parseEnvelope(input: string | unknown): EncryptedBackup {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new BackupError('formato');
    }
  }
  const e = data as Partial<EncryptedBackup> | null;
  if (!e || typeof e !== 'object' || e.format !== ENC_FORMAT) throw new BackupError('formato');
  for (const field of ['salt', 'iv', 'check', 'ciphertext'] as const) {
    if (typeof e[field] !== 'string' || !e[field]) throw new BackupError('formato');
  }
  // Una cabecera con otro KDF o con otras iteraciones no la genero Fize: archivo alterado (y evita que un
  // archivo malicioso pida millones de iteraciones y congele la pagina).
  if (!e.kdf || e.kdf.name !== 'PBKDF2' || e.kdf.hash !== 'SHA-256' || e.kdf.iterations !== KDF_ITERATIONS) {
    throw new BackupError('alterado');
  }
  return e as EncryptedBackup;
}

export function validatePlainBackup(data: unknown): PlainBackup {
  const b = data as Partial<PlainBackup> | null;
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT || typeof b.appId !== 'string') {
    throw new BackupError('formato');
  }
  if (!b.stores || typeof b.stores !== 'object' || Array.isArray(b.stores)) throw new BackupError('formato');
  for (const v of Object.values(b.stores)) if (!Array.isArray(v)) throw new BackupError('formato');
  return b as PlainBackup;
}

/** Descifra y valida. Lanza `BackupError` ('formato' | 'codigo' | 'alterado') con mensaje en español. */
export async function decryptBackup(input: string | unknown, code: string): Promise<PlainBackup> {
  const env = parseEnvelope(input);
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new BackupError('codigo', 'El código de recuperación debe tener 16 caracteres (4 grupos de 4).');
  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try {
    salt = fromB64(env.salt);
    iv = fromB64(env.iv);
    ct = fromB64(env.ciphertext);
  } catch {
    throw new BackupError('alterado');
  }
  const { key, check } = await deriveKeys(normalized, salt, env.kdf.iterations);
  if (check !== env.check) throw new BackupError('codigo');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(env) }, key, ct);
  } catch {
    throw new BackupError('alterado');
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new BackupError('alterado');
  }
  return validatePlainBackup(data);
}
