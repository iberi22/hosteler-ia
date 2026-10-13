<!--
  OrderCard.svelte — KDS order card (Wave-H1.07 + H4.05)
  Patron: @swal/ui Card.svelte + StatusBadge.svelte
  Estados: pending → preparing → ready → served → paid / cancelled
  Transiciones via API: POST /api/orders/[id]/transition
  Cobro (served -> paid): abre PaymentForm (metodo + monto, POST /api/orders/[id]/payment).
-->
<script lang="ts">
  import { StatusBadge, Card, Badge } from '@swal/ui';
  import { formatCOP } from '../../lib/money';
  import PaymentForm from './PaymentForm.svelte';
  import { orders, setStatus, type Order, type OrderStatus } from '../../stores/orders.svelte';
  import { ORDER_STATUS_BADGE_LABELS } from '../../lib/orderStateMachine';
  import { api } from '../../lib/api-client';
  import { mapOrder } from '../../lib/storeSync';

  let { order, tableNumber = null, onStatusChange } = $props<{
    order: Order;
    /** Numero de mesa resuelto por KitchenQueue (el id interno no le dice nada al personal, QA #3). */
    tableNumber?: number | null;
    onStatusChange?: (id: string, status: OrderStatus) => void;
  }>();

  let errorMsg = $state<string | null>(null);
  let isTransitioning = $state(false);

  // StatusBadge solo entiende 4 estados; mapeamos pedido→ sistema.
  function statusToBadge(o: OrderStatus): 'healthy' | 'warning' | 'error' | 'offline' {
    switch (o) {
      case 'ready':
      case 'paid':
      case 'served':
        return 'healthy';
      case 'preparing':
        return 'warning';
      case 'cancelled':
        return 'error';
      case 'pending':
      default:
        return 'offline';
    }
  }

  const NEXT: Record<OrderStatus, OrderStatus | null> = {
    pending: 'preparing',
    preparing: 'ready',
    ready: 'served',
    served: 'paid',
    paid: null,
    cancelled: null,
  };

  // Formulario de cobro. Se abre al pulsar "→ paid".
  let showPayment = $state(false);

  function applyUpdated(raw: unknown) {
    const updated = mapOrder(raw) as Order;
    const idx = orders.list.findIndex((o) => o.id === order.id);
    if (idx !== -1) {
      orders.list[idx] = updated;
    } else {
      orders.list.push(updated);
    }
    setStatus(order.id, updated.status);
    onStatusChange?.(order.id, updated.status);
  }

  /** Respuesta 201 de POST /api/orders/[id]/payment: `{ order, payment }`. */
  function onPaid(body: unknown) {
    const data = (body ?? {}) as { order?: unknown };
    applyUpdated(data.order ?? body);
    showPayment = false;
  }

  async function performTransition(next: OrderStatus) {
    if (isTransitioning) return;
    isTransitioning = true;
    errorMsg = null;

    try {
      const res = await api.post(`/api/orders/${encodeURIComponent(order.id)}/transition`, { to: next });
      if (res.ok) {
        applyUpdated(await res.json());
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        errorMsg = data.error || `Error ${res.status}: Transición no permitida`;
      }
    } catch {
      errorMsg = 'Error de conexión con el servidor';
    } finally {
      isTransitioning = false;
    }
  }

  function advance() {
    const status = order.status as OrderStatus;
    const next = NEXT[status];
    if (!next) return;
    // Marcar pagado no es una transicion simple: exige metodo y monto, y deja
    // un registro de pago. Abrimos el formulario en vez de cerrar el pedido en
    // seco, que es lo que hacia antes (quedaba sin saber como se cobro).
    if (next === 'paid') {
      showPayment = true;
      return;
    }
    void performTransition(next);
  }

  function cancel() {
    void performTransition('cancelled');
  }

  function elapsed(): string {
    const ms = Date.now() - order.createdAt;
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }

  let now = $state(Date.now());
  $effect(() => {
    if (typeof window === 'undefined') return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  void now;

  // Calcular el total desde los items, no desde order.totalPrice: el KDS no
  // siempre lo recibe (pedidos que llegan por mesh), y con totalPriceundefined
  // el footer pintaba "$ 0" aunque los items si traen unitPrice.
  interface PricedItem {
    unitPrice?: number | null;
    quantity?: number | null;
  }
  const pricedItems = $derived((order.items ?? []) as PricedItem[]);
  const total = $derived(
    pricedItems.reduce((sum: number, it: PricedItem) => sum + Number(it.unitPrice ?? 0) * Number(it.quantity ?? 1), 0),
  );
</script>

<Card variant="elevated" padding="md">
  <div class="kds-card">
    <header class="kds-header">
      <div class="meta">
        <Badge variant="info">Mesa {tableNumber ?? '—'}</Badge>
        <span class="id">{order.id.slice(-6)}</span>
      </div>
      <div class="status">
        <StatusBadge status={statusToBadge(order.status)} />
        <span class="label">{ORDER_STATUS_BADGE_LABELS[order.status]}</span>
      </div>
    </header>

    <ul class="items">
      {#each order.items as item (item.menuItemId)}
        <li>
          <span class="qty">{item.quantity}×</span>
          <span class="name">{item.name}</span>
          <span class="price">{formatCOP(item.unitPrice * item.quantity)}</span>
        </li>
      {/each}
    </ul>

    {#if order.notes}
      <p class="notes" aria-label="Notas del pedido">📝 {order.notes}</p>
    {/if}

    {#if errorMsg}
      <p class="error-msg" aria-label="Error de transición">⚠️ {errorMsg}</p>
    {/if}

    <footer class="kds-footer">
      <span class="time" aria-label="Tiempo transcurrido">⏱ {elapsed()}</span>
      <span class="total">{formatCOP(total)}</span>
    </footer>

    <div class="actions">
      {#if NEXT[order.status as OrderStatus]}
        <button class="btn primary" onclick={advance} disabled={isTransitioning}>
          {isTransitioning ? 'Procesando...' : `→ ${ORDER_STATUS_BADGE_LABELS[NEXT[order.status as OrderStatus] as OrderStatus]}`}
        </button>
      {/if}
      {#if order.status !== 'cancelled' && order.status !== 'paid'}
        <button class="btn ghost" onclick={cancel} disabled={isTransitioning}>
          Cancelar
        </button>
      {/if}
    </div>

    {#if showPayment}
      <PaymentForm orderId={order.id} {total} {onPaid} onCancel={() => (showPayment = false)} />
    {/if}
  </div>
</Card>

<style>
  .kds-card {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 16rem;
    max-width: 22rem;
  }
  .kds-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .meta { display: flex; align-items: center; gap: 0.5rem; }
  .id {
    font-family: var(--swal-font-mono);
    font-size: 0.78rem;
    color: var(--swal-text-muted);
  }
  .status { display: flex; align-items: center; gap: 0.4rem; }
  .label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--swal-text-secondary);
  }
  .items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .items li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    color: var(--swal-text);
    font-size: 0.92rem;
  }
  .qty {
    color: var(--swal-accent-cyan);
    font-family: var(--swal-font-mono);
    font-weight: 700;
  }
  .price { color: var(--swal-text-secondary); font-family: var(--swal-font-mono); }
  .notes {
    margin: 0;
    padding: 0.5rem 0.65rem;
    background: rgba(255, 165, 0, 0.08);
    border-left: 3px solid var(--swal-accent-orange);
    border-radius: 4px;
    color: var(--swal-text-secondary);
    font-size: 0.82rem;
  }
  .error-msg {
    margin: 0;
    padding: 0.45rem 0.65rem;
    background: rgba(239, 68, 68, 0.12);
    border-left: 3px solid var(--swal-danger);
    border-radius: 4px;
    color: var(--swal-danger);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .kds-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--swal-text-muted);
    font-size: 0.85rem;
    border-top: 1px solid var(--swal-border);
    padding-top: 0.5rem;
  }
  .total {
    font-family: var(--swal-font-mono);
    font-weight: 700;
    color: var(--swal-accent-cyan);
    font-size: 1.05rem;
  }
  .actions { display: flex; gap: 0.5rem; }
  .btn {
    flex: 1;
    padding: 0.55rem 0.75rem;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    border: 1px solid var(--swal-border);
    background: var(--swal-bg-elevated);
    color: var(--swal-text);
    transition: transform 0.12s ease, background 0.12s ease;
  }
  .btn:hover:not(:disabled) { transform: translateY(-1px); }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--swal-accent-cyan);
    color: #0a0a0a;
    border-color: var(--swal-accent-cyan);
  }
  .btn.primary:hover:not(:disabled) { background: var(--swal-cyan-bright, #06b6d4); }
  .btn.ghost {
    background: transparent;
    color: var(--swal-text-secondary);
  }
  .btn.ghost:hover:not(:disabled) {
    color: var(--swal-accent-orange);
    border-color: var(--swal-accent-orange);
  }
  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
    .btn:hover { transform: none; }
  }

</style>
