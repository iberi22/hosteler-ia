/**
 * Planificador de sondeo del KDS (plan gratuito de Cloudflare: cada peticion
 * cuenta). Pausa con la pestana oculta, backoff exponencial 15 s -> 30 s si
 * no hay cambios y vuelta a 15 s ante un cambio o una accion del usuario.
 * El API de pedidos no devuelve ETag, asi que no se usa If-None-Match.
 */
export const BASE_POLL_MS = 15_000;
export const MAX_POLL_MS = 30_000;

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
  now?: () => number;
}

export function createKitchenPoller(opts: KitchenPollerOptions) {
  const isHidden =
    opts.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const now = opts.now ?? (() => Date.now());

  let delay = BASE_POLL_MS;
  let dueAt = 0;
  let handle: unknown = null;
  let running = false;
  let inFlight = false;
  let resetDuringFlight = false;

  function cancel() {
    if (handle !== null) clearTimer(handle);
    handle = null;
  }

  function schedule() {
    cancel();
    if (!running || isHidden()) return;
    dueAt = now() + delay;
    handle = setTimer(tick, delay);
  }

  async function tick() {
    handle = null;
    if (!running || isHidden() || inFlight) return;
    inFlight = true;
    resetDuringFlight = false;
    let changed = false;
    try {
      changed = await opts.poll();
    } catch {
      changed = false;
    } finally {
      inFlight = false;
    }
    delay = resetDuringFlight ? BASE_POLL_MS : nextPollDelay(delay, changed);
    resetDuringFlight = false;
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
    /**
     * Accion del usuario: vuelve al ritmo base sin posponer un sondeo ya
     * programado (si no, acciones frecuentes dejarian la cola sin sondear).
     */
    reset() {
      delay = BASE_POLL_MS;
      if (inFlight) resetDuringFlight = true;
      if (!running || isHidden()) return;
      if (handle !== null) {
        if (dueAt - now() > BASE_POLL_MS) schedule();
        return;
      }
      if (!inFlight) schedule();
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

export interface KitchenPollingSetupOptions {
  poll: () => Promise<boolean>;
  isDestroyed: () => boolean;
  target?: Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Crea el poller y engancha los listeners del documento, salvo que el
 * componente ya se haya desmontado mientras esperaba la carga inicial.
 * Devuelve null (sin poller ni listeners) en ese caso.
 */
export function setupKitchenPolling(opts: KitchenPollingSetupOptions) {
  if (opts.isDestroyed()) return null;
  const target = opts.target ?? document;
  const poller = createKitchenPoller({ poll: opts.poll });
  const onVisibility = () => poller.onVisibilityChange();
  const onUserAction = () => poller.reset();
  poller.start();
  target.addEventListener('visibilitychange', onVisibility);
  target.addEventListener('pointerdown', onUserAction);
  target.addEventListener('keydown', onUserAction);
  return {
    poller,
    dispose() {
      poller.stop();
      target.removeEventListener('visibilitychange', onVisibility);
      target.removeEventListener('pointerdown', onUserAction);
      target.removeEventListener('keydown', onUserAction);
    },
  };
}
