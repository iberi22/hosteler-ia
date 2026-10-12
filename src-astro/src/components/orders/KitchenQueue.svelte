<!--
  KitchenQueue.svelte — KDS live queue (Wave-H1.07 + H4.05)
  Reune OrderCards agrupadas por status. Suscribe a mesh `order:created`.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@swal/ui';
  import OrderCard from './OrderCard.svelte';
  import {
    orders,
    hydrateOrders,
    type Order,
    type OrderStatus,
  } from '../../stores/orders.svelte';
  import { meshSubscribe, meshPublish } from '../../lib/mesh';
  import { api } from '../../lib/api-client';
  import { isLocalMode } from '../../lib/local/localMode';
  import { isOrderStatus, ORDER_STATUS_LABELS } from '../../lib/orderStateMachine';
  import { mapOrder } from '../../lib/storeSync';
  import { normalizeOrdersPayload } from '../../lib/orderSync';
  import type { DomainRecord } from '../../lib/domain';

  let { autoPublish = true, statuses }: { autoPublish?: boolean; statuses?: OrderStatus[] } = $props();

  let unsub: (() => void) | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  // 'served' va incluida a proposito: sin ella los pedidos que ya salieron de
  // la cocina desaparecian del KDS y no habia forma de cobrar. El cobro se
  // dispara desde ahi (boton "-> paid" con el formulario de metodo y monto).
  const ACTIVE_STATUSES: OrderStatus[] = ['pending', 'preparing', 'ready', 'served'];

  /**
   * Carriles visibles. Las paginas de pedidos (/dashboard/orders, /local/pedidos)
   * pasan el filtro `?status=` de la URL: sin el, `?status=paid` pintaba los
   * carriles activos y un pedido cobrado era invisible tras recargar. El KDS
   * (cocina) no pasa filtro y sigue con los 4 carriles activos.
   *
   * El `?status=` de la URL en tiempo de ejecucion manda sobre la prop: las
   * paginas prerenderizadas (/local/pedidos) congelan la prop en el build, asi
   * que sin esta lectura el filtro nunca se aplicaria en ellas. No hay
   * ViewTransitions en los layouts: cada navegacion monta la isla de nuevo.
   */
  function urlStatusFilter(): OrderStatus | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = new URLSearchParams(window.location.search).get('status');
      return isOrderStatus(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  const urlFilter = urlStatusFilter();
  const lanes = $derived(
    urlFilter ? [urlFilter] : statuses && statuses.length > 0 ? [...statuses] : ACTIVE_STATUSES,
  );

  const COUNTER_LABELS: Record<OrderStatus, string> = {
    pending: '⏳ pendientes',
    preparing: '🔥 en cocina',
    ready: '✅ listos',
    served: '🍽️ por cobrar',
    paid: '💰 cobrados',
    cancelled: '🚫 cancelados',
  };

  const EMPTY_LABELS: Record<OrderStatus, string> = {
    pending: 'Sin pedidos pendientes',
    preparing: 'Sin pedidos en preparación',
    ready: 'Sin pedidos listos',
    served: 'Nada por cobrar',
    paid: 'Nada cobrado',
    cancelled: 'Sin pedidos cancelados',
  };

  /** Index por estado, para que el #each de cada lane no tenga que ternarse. */
  const byStatus = $derived(
    Object.fromEntries(lanes.map((s) => [s, orders.list.filter((o) => o.status === s)])) as Record<
      OrderStatus,
      typeof orders.list
    >,
  );

  let log = $state<{ id: number; ts: string; text: string }[]>([
    { id: 0, ts: new Date().toISOString().slice(11, 19), text: '[kds] queue ready — esperando pedidos...' },
  ]);
  let logCounter = 1;

  function pushLog(text: string) {
    log = [
      ...log,
      { id: logCounter++, ts: new Date().toISOString().slice(11, 19), text },
    ].slice(-50);
  }

  async function pollBackend() {
    if (typeof window === 'undefined') return;
    try {
      const res = await api.get('/api/orders');
      if (!res.ok) return;
      const data = await res.json();
      // Bare-array or { list: [...] } payload normalization
      const isArray = Array.isArray(data);
      const rawList = normalizeOrdersPayload(isArray ? data : data);

      for (const o of rawList) {
        const existingIdx = orders.list.findIndex((x) => x.id === o.id);
        if (existingIdx !== -1) {
          const old = orders.list[existingIdx];
          if (old.status !== o.status) {
            pushLog(`[kds] backend status update ${o.id.slice(-6)} (${old.status} → ${o.status})`);
          }
          orders.list[existingIdx] = o as Order;
        } else {
          orders.list.push(o as Order);
          pushLog(`[kds] backend sync ${o.id.slice(-6)} (${o.status})`);
        }
      }
    } catch {
      /* tolerate backend offline — store local-first */
    }
  }

  onMount(async () => {
    hydrateOrders();
    pushLog(`[kds] loaded ${orders.list.length} orders from local storage`);

    try {
      unsub = await meshSubscribe('order:created', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const rec = payload as Record<string, unknown>;
        if (!rec.id) return;
        const o = ('items' in rec && 'createdAt' in rec ? rec : mapOrder(rec as DomainRecord)) as Order;
        const existingIdx = orders.list.findIndex((x) => x.id === o.id);
        if (existingIdx !== -1) {
          orders.list[existingIdx] = o;
        } else {
          orders.list.push(o);
          pushLog(`[kds] mesh order:created ${o.id.slice(-6)} (${o.status})`);
        }
      });
      pushLog('[kds] subscribed to mesh:order:created');
    } catch {
      pushLog('[kds] mesh unavailable — local-only mode');
    }

    // Se espera a la sincronizacion con el backend antes de decidir si sembrar:
    // sin el await, la lista aun vacia sembraba duplicados sobre pedidos que ya
    // estaban en IndexedDB/D1 y todavia no habian llegado al store.
    await pollBackend();
    pollHandle = setInterval(pollBackend, 15_000);

    if (autoPublish && orders.list.length === 0) {
      if (isLocalMode()) {
        await seedLocalDemoOrders();
      } else {
        const demo = demoSeed();
        for (const o of demo) {
          orders.list.push(o);
          await meshPublish('order:created', o);
          pushLog(`[kds] demo published ${o.id.slice(-6)}`);
        }
      }
    }
  });

  onDestroy(() => {
    unsub?.();
    if (pollHandle) clearInterval(pollHandle);
  });

  /** Mesa local por numero: la reutiliza si existe, la crea si no. Null si el backend no responde. */
  async function ensureLocalTable(number: number): Promise<string | null> {
    try {
      const res = await api.get('/api/tables');
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      const found = list.find((t) => Number(t.number) === number && !t.deleted_at);
      if (found && typeof found.id === 'string') return found.id;
      const created = await api.post('/api/tables', { number, capacity: 4 });
      if (!created.ok) return null;
      const body = (await created.json()) as Record<string, unknown>;
      return typeof body.id === 'string' ? body.id : null;
    } catch {
      return null;
    }
  }

  /**
   * Semilla demo del KDS en modo local: pedidos REALES en IndexedDB (el mismo
   * backend que leen las transiciones y el cobro), no fantasmas en memoria.
   *
   * Causa raiz del E2E offline-local-first: la semilla anterior empujaba
   * `demo-<ts>-N` solo al store Svelte; el POST /api/orders/<demo-id>/transition
   * respondia 404 "Order not found" y el contador "por cobrar" nunca se movia.
   * Aqui se crean las mesas que falten, se arman los pedidos con platos reales
   * de la carta (el alta hidrata nombre/precio) y dos de ellos avanzan por la
   * maquina de estados real. Sin carta no hay demo funcional: el KDS queda
   * vacio en vez de pintar tarjetas que fallan al pulsarlas.
   */
  async function seedLocalDemoOrders(): Promise<void> {
    let ids: string[] = [];
    try {
      const res = await api.get('/api/menu-items');
      if (!res.ok) return;
      const data: unknown = await res.json();
      const raw = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      ids = raw
        .filter((m) => !m.deleted_at && m.isAvailable !== false && typeof m.id === 'string')
        .map((m) => m.id as string);
    } catch {
      return;
    }
    if (ids.length === 0) return;

    const pick = (i: number): string => ids[i % ids.length];
    const plans: {
      table: number;
      items: { menuItemId: string; qty: number }[];
      advance: OrderStatus[];
      note?: string;
    }[] = [
      {
        table: 3,
        items: [{ menuItemId: pick(0), qty: 2 }, ...(ids.length > 1 ? [{ menuItemId: pick(1), qty: 1 }] : [])],
        advance: [],
      },
      {
        table: 7,
        items: [{ menuItemId: pick(0), qty: 1 }, ...(ids.length > 1 ? [{ menuItemId: pick(1), qty: 1 }] : [])],
        advance: ['preparing'],
        note: 'Sin cebolla',
      },
      {
        table: 12,
        items: [{ menuItemId: pick(ids.length - 1), qty: 1 }],
        advance: ['preparing', 'ready'],
      },
    ];

    for (const plan of plans) {
      try {
        const tableId = await ensureLocalTable(plan.table);
        if (!tableId) continue;
        const created = await api.post('/api/orders', {
          tableId,
          items: plan.items,
          ...(plan.note ? { note: plan.note } : {}),
        });
        if (!created.ok) continue;
        let rec = (await created.json()) as DomainRecord;
        let ok = true;
        for (const to of plan.advance) {
          const recId = String((rec as unknown as Record<string, unknown>).id);
          const tr = await api.post(`/api/orders/${encodeURIComponent(recId)}/transition`, { to });
          if (!tr.ok) {
            ok = false;
            break;
          }
          rec = (await tr.json()) as DomainRecord;
        }
        if (!ok) continue;
        const o = mapOrder(rec) as Order;
        orders.list.push(o);
        await meshPublish('order:created', o);
        pushLog(`[kds] demo publicada ${o.id.slice(-6)} (${o.status})`);
      } catch {
        continue;
      }
    }
  }

  function demoSeed(): Order[] {
    const now = Date.now();
    // Precios en COP, no en euros: estos pedidos se pintan en la demo delante
    // del restaurante y "Café con leche $ 2.50" delata que la app no esta
    // localizada. Los valores reales salen de /api/menu-items.
    return [
      {
        id: `demo-${now}-1`,
        tableId: '3',
        items: [
          { menuItemId: 'm1', name: 'Café con leche', quantity: 2, unitPrice: 8500 },
          { menuItemId: 'm2', name: 'Tostada integral', quantity: 1, unitPrice: 12000 },
        ],
        totalPrice: 29000,
        status: 'pending',
        createdAt: now - 60_000,
        updatedAt: now,
      },
      {
        id: `demo-${now}-2`,
        tableId: '7',
        items: [
          { menuItemId: 'm3', name: 'Hamburguesa clásica', quantity: 1, unitPrice: 32000 },
          { menuItemId: 'm4', name: 'Patatas bravas', quantity: 1, unitPrice: 14000 },
        ],
        totalPrice: 46000,
        status: 'preparing',
        createdAt: now - 180_000,
        updatedAt: now,
        notes: 'Sin cebolla',
      },
      {
        id: `demo-${now}-3`,
        tableId: '12',
        items: [
          { menuItemId: 'm5', name: 'Ensalada César', quantity: 1, unitPrice: 28000 },
        ],
        totalPrice: 28000,
        status: 'ready',
        createdAt: now - 360_000,
        updatedAt: now,
      },
    ];
  }

  function handleStatusChange(id: string, status: OrderStatus) {
    pushLog(`[kds] transition ${id.slice(-6)} → ${status}`);
    void meshPublish('order:status', { id, status });
  }
</script>

<section class="kds-queue">
  <header class="kds-header">
    <h2>🍳 Cocina — KDS Realtime</h2>
    <div class="counters" aria-label="Contadores KDS">
      {#each lanes as status (status)}
        <span class="counter {status}">{byStatus[status].length} {COUNTER_LABELS[status]}</span>
      {/each}
    </div>
  </header>

  <div class="kds-grid">
    {#each lanes as status (status)}
      <div class="lane" data-status={status}>
        <h3 class="lane-title">{ORDER_STATUS_LABELS[status].toUpperCase()}</h3>
        <div class="lane-items">
          {#if byStatus[status].length === 0}
            <p class="empty">{EMPTY_LABELS[status]}</p>
          {/if}
          {#each byStatus[status] as o (o.id)}
            <OrderCard order={o} onStatusChange={handleStatusChange} />
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <details class="logs">
    <summary>📋 Log de eventos (mesh + backend)</summary>
    <Terminal logs={log.map((l) => ({ id: String(l.id), timestamp: l.ts, level: 'INFO', service: 'kds', message: l.text }))} title="KDS_EVENTS >> swal/hosteler-ia" height="14rem" />
  </details>
</section>

<style>
  .kds-queue {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .kds-header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
  }
  .kds-header h2 {
    margin: 0;
    color: var(--swal-text);
    font-size: 1.25rem;
  }
  .counters { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .counter {
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    font-size: 0.82rem;
    font-family: var(--swal-font-mono);
    font-weight: 700;
    background: var(--swal-bg-elevated);
    border: 1px solid var(--swal-border);
    color: var(--swal-text-secondary);
  }
  .counter.pending { border-color: var(--swal-accent-orange); color: var(--swal-accent-orange); }
  .counter.preparing { border-color: var(--swal-accent-cyan); color: var(--swal-accent-cyan); }
  .counter.ready { color: var(--swal-success); border-color: var(--swal-success); }
  .counter.served { color: #a78bfa; border-color: #a78bfa; }
  .counter.paid { color: var(--swal-success); border-color: var(--swal-success); }
  .counter.cancelled { color: var(--swal-danger, #ef4444); border-color: var(--swal-danger, #ef4444); }

  .kds-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1rem;
  }
  .lane {
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border);
    border-radius: 8px;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-height: 12rem;
  }
  .lane[data-status='preparing'] { border-left: 3px solid var(--swal-accent-cyan); }
  .lane[data-status='ready'] { border-left: 3px solid var(--swal-success); }
  .lane[data-status='pending'] { border-left: 3px solid var(--swal-accent-orange); }
  .lane[data-status='served'] { border-left: 3px solid #a78bfa; }
  .lane[data-status='paid'] { border-left: 3px solid var(--swal-success); }
  .lane[data-status='cancelled'] { border-left: 3px solid var(--swal-danger, #ef4444); }
  .lane-title {
    margin: 0;
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    color: var(--swal-text-muted);
    font-weight: 700;
  }
  .lane-items {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .empty {
    color: var(--swal-text-muted);
    font-size: 0.85rem;
    font-style: italic;
    margin: 0;
    text-align: center;
    padding: 1rem 0;
  }
  .logs summary {
    cursor: pointer;
    color: var(--swal-text-secondary);
    font-size: 0.92rem;
    padding: 0.5rem 0;
  }
</style>