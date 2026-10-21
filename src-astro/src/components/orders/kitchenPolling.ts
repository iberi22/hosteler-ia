/**
 * Planificador de sondeo del KDS (plan gratuito de Cloudflare: cada peticion
 * cuenta). Pausa con la pestana oculta, backoff exponencial 15 s -> 120 s si
 * no hay cambios y vuelta a 15 s ante un cambio o una accion del usuario.
 * El API de pedidos no devuelve ETag, asi que no se usa If-None-Match.
 */
export const BASE_POLL_MS = 15_000;
export const MAX_POLL_MS = 120_000;

export function nextPollDelay(current: number, changed: boolean): number {
  if (changed) return BASE_POLL_MS;
  return Math.min(current * 2, MAX_POLL_MS);
}

export interface KitchenPollerOptions {
  /** Devuelve true si el sondeo trajo cambios. */
  poll: () => Promise<boolean>;
  isHidden?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createKitchenPoller(opts: KitchenPollerOptions) {
  const isHidden =
    opts.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let delay = BASE_POLL_MS;
  let handle: unknown = null;
  let running = false;
  let inFlight = false;

  function cancel() {
    if (handle !== null) clearTimer(handle);
    handle = null;
  }

  function schedule() {
    cancel();
    if (!running || isHidden()) return;
    handle = setTimer(tick, delay);
  }

  async function tick() {
    handle = null;
    if (!running || isHidden() || inFlight) return;
    inFlight = true;
    let changed = false;
    try {
      changed = await opts.poll();
    } catch {
      changed = false;
    } finally {
      inFlight = false;
    }
    delay = nextPollDelay(delay, changed);
    schedule();
  }

  return {
    /** Programa el primer sondeo (el llamador ya hizo la carga inicial). */
    start() {
      running = true;
      delay = BASE_POLL_MS;
      schedule();
    },
    stop() {
      running = false;
      cancel();
    },
    /** Accion del usuario: vuelve al ritmo base. */
    reset() {
      delay = BASE_POLL_MS;
      schedule();
    },
    onVisibilityChange() {
      if (!running) return;
      if (isHidden()) {
        cancel();
      } else {
        cancel();
        void tick();
      }
    },
  };
}
