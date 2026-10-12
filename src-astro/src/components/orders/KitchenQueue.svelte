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
  import { mapOrder } from '../../lib/storeSync';
  import { normalizeOrdersPayload } from '../../lib/orderSync';
  import type { DomainRecord } from '../../lib/domain';

  let { autoPublish = true }: { autoPublish?: boolean } = $props();

  let unsub: (() => void) | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  // 'served' va incluida a proposito: sin ella los pedidos que ya salieron de
  // la cocina desaparecian del KDS y no habia forma de cobrar. El cobro se
  // dispara desde ahi (boton "-> paid" con el formulario de metodo y monto).
  const ACTIVE_STATUSES: OrderStatus[] = ['pending', 'preparing', 'ready', 'served'];

  const pending = $derived(orders.list.filter((o) => o.status === 'pending'));
  const preparing = $derived(orders.list.filter((o) => o.status === 'preparing'));
  const ready = $derived(orders.list.filter((o) => o.status === 'ready'));
  const served = $derived(orders.list.filter((o) => o.status === 'served'));

  /** Index por estado, para que el #each de cada lane no tenga que ternarse. */
  const byStatus = $derived(
    Object.fromEntries(ACTIVE_STATUSES.map((s) => [s, orders.list.filter((o) => o.status === s)])) as Record<
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

    pollBackend();
    pollHandle = setInterval(pollBackend, 15_000);

    if (autoPublish && orders.list.length === 0) {
      const demo = demoSeed();
      for (const o of demo) {
        orders.list.push(o);
        await meshPublish('order:created', o);
        pushLog(`[kds] demo published ${o.id.slice(-6)}`);
      }
    }
  });

  onDestroy(() => {
    unsub?.();
    if (pollHandle) clearInterval(pollHandle);
  });

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
      <span class="counter pending">{pending.length} ⏳ pendientes</span>
      <span class="counter preparing">{preparing.length} 🔥 en cocina</span>
      <span class="counter ready">{ready.length} ✅ listos</span>
      <span class="counter served">{served.length} 🍽️ por cobrar</span>
    </div>
  </header>

  <div class="kds-grid">
    {#each ACTIVE_STATUSES as status (status)}
      <div class="lane" data-status={status}>
        <h3 class="lane-title">{status.toUpperCase()}</h3>
        <div class="lane-items">
          {#if status === 'pending' && pending.length === 0}
            <p class="empty">Sin pedidos pendientes</p>
          {:else if status === 'preparing' && preparing.length === 0}
            <p class="empty">Sin pedidos en preparación</p>
          {:else if status === 'ready' && ready.length === 0}
            <p class="empty">Sin pedidos listos</p>
          {:else if status === 'served' && served.length === 0}
            <p class="empty">Nada por cobrar</p>
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