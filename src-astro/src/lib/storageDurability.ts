// storageDurability.ts — protege los datos locales (offline-first) de la expulsión del navegador
// y avisa cuando se llena la cuota. Safari/iOS y Chrome pueden borrar IndexedDB de un sitio sin
// `navigator.storage.persist()`; con datos solo-locales eso sería pérdida silenciosa.

export interface QuotaInfo {
  usage: number;
  quota: number;
  /** 0..1, o null si el navegador no informa la cuota. */
  ratio: number | null;
}

let persistAttempted = false;
let persisted: boolean | null = null;

export function resetDurabilityForTests(): void {
  persistAttempted = false;
  persisted = null;
}

/** Pide almacenamiento persistente una sola vez (primera escritura o arranque). Nunca lanza. */
export async function ensurePersistentStorage(): Promise<boolean> {
  if (persistAttempted) return persisted === true;
  persistAttempted = true;
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.persist) return false;
    if (s.persisted && (await s.persisted())) {
      persisted = true;
      return true;
    }
    persisted = await s.persist();
    return persisted;
  } catch {
    persisted = false;
    return false;
  }
}

/** Uso y cuota actuales vía navigator.storage.estimate(); null si no está disponible. */
export async function getStorageQuota(): Promise<QuotaInfo | null> {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.estimate) return null;
    const { usage = 0, quota = 0 } = await s.estimate();
    return { usage, quota, ratio: quota > 0 ? usage / quota : null };
  } catch {
    return null;
  }
}

export function isQuotaExceededError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; code?: number };
  return err.name === 'QuotaExceededError' || err.code === 22 || err.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

type Notifier = (message: string, title?: string) => void;
let notifier: Notifier | null = null;

/** Inyecta el notificador (tests). Por defecto: toast.error de @swal/ui. */
export function setQuotaNotifier(fn: Notifier | null): void {
  notifier = fn;
}

async function notify(message: string, title: string): Promise<void> {
  try {
    if (notifier) return notifier(message, title);
    const { toast } = await import('@swal/ui/toast');
    toast.error(message, title);
  } catch {
    /* sin UI disponible (SSR/tests): el error original igualmente se propaga */
  }
}

/**
 * Si `e` es QuotaExceededError muestra un toast visible para el usuario y devuelve true.
 * El llamador debe relanzar el error: la escritura NO se guardó.
 */
export async function reportIfQuotaExceeded(e: unknown): Promise<boolean> {
  if (!isQuotaExceededError(e)) return false;
  const q = await getStorageQuota();
  const pct = q?.ratio != null ? ` (${Math.round(q.ratio * 100)}% usado)` : '';
  await notify(
    `El almacenamiento del dispositivo está lleno${pct}. El último cambio no se guardó. Libera espacio o exporta tus datos.`,
    'Sin espacio',
  );
  return true;
}
