<!-- AnalyticsDashboard.svelte — Analytics dashboard main container with fetch & auto-refresh -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@swal/ui';
  import SalesSummary from './SalesSummary.svelte';
  import TopItems from './TopItems.svelte';
  import LowStockPanel from './LowStockPanel.svelte';
  import { apiFetch } from '../../lib/api-client';
  import {
    fetchCollection,
    mapOrder,
    mapMenuItem,
    mapInventoryItem,
    type StoreOrder,
    type StoreMenuItem,
    type StoreInventoryItem,
  } from '../../lib/storeSync';
  import {
    calculateSalesSummary,
    calculateTopItems,
    calculateLowStock,
  } from '../../lib/analytics';

  let loading = $state(true);
  let error = $state<string | null>(null);

  let orders = $state<StoreOrder[]>([]);
  let menuItems = $state<StoreMenuItem[]>([]);
  let inventory = $state<StoreInventoryItem[]>([]);

  const salesSummary = $derived(calculateSalesSummary(orders));
  const topItems = $derived(calculateTopItems(orders, menuItems, 5));
  const lowStockItems = $derived(calculateLowStock(inventory, 5));

  async function loadData() {
    loading = true;
    error = null;
    try {
      // Fetches live data from endpoints: api/orders, api/menu-items, api/inventory
      const [rawOrders, rawMenu, rawInventory] = await Promise.all([
        fetchCollection(apiFetch, 'orders'),
        fetchCollection(apiFetch, 'menu-items'),
        fetchCollection(apiFetch, 'inventory'),
      ]);

      orders = rawOrders.map(mapOrder);
      menuItems = rawMenu.map(mapMenuItem);
      inventory = rawInventory.map(mapInventoryItem);
    } catch (err) {
      error = (err as Error).message || 'Error al cargar datos de analítica';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<div class="analytics-dashboard">
  <div class="top-bar">
    <div class="title-meta">
      <h2 class="page-heading">Métricas del Restaurante</h2>
      <p class="page-subheading">Visión en tiempo real de ventas, platillos y stock</p>
    </div>
    <div class="actions">
      <Button variant="outline" size="sm" onclick={loadData} disabled={loading}>
        {#if loading}
          Cargando...
        {:else}
          Refresh
        {/if}
      </Button>
    </div>
  </div>

  {#if error}
    <div class="error-banner" role="alert">
      <span>⚠️ Error al cargar métricas: {error}</span>
      <Button variant="ghost" size="sm" onclick={loadData}>Reintentar</Button>
    </div>
  {:else if loading && orders.length === 0}
    <div class="loading-state" aria-busy="true">
      <div class="spinner"></div>
      <span>Cargando analítica...</span>
    </div>
  {:else}
    <div class="dashboard-grid">
      <div class="grid-col span-2">
        <SalesSummary summary={salesSummary} />
      </div>
      <div class="grid-col">
        <LowStockPanel items={lowStockItems} />
      </div>
      <div class="grid-col span-3">
        <TopItems items={topItems} />
      </div>
    </div>
  {/if}
</div>

<style>
  .analytics-dashboard {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .page-heading {
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--swal-text, #f8fafc);
    margin: 0;
  }

  .page-subheading {
    font-size: 0.875rem;
    color: var(--swal-text-secondary, #94a3b8);
    margin: 0.25rem 0 0 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    background: var(--swal-danger-bg, rgba(239, 68, 68, 0.1));
    border: 1px solid var(--swal-danger, #ef4444);
    border-radius: 8px;
    color: var(--swal-text, #f8fafc);
    font-size: 0.875rem;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 1rem;
    gap: 1rem;
    color: var(--swal-text-secondary, #94a3b8);
    font-size: 0.875rem;
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--swal-border, rgba(255, 255, 255, 0.1));
    border-top-color: var(--swal-neon-cyan, #22d3ee);
    border-radius: 50%;
    animation: spin 800ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.25rem;
  }

  .grid-col.span-2 {
    grid-column: span 2;
  }

  .grid-col.span-3 {
    grid-column: span 3;
  }

  @media (max-width: 900px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }

    .grid-col.span-2,
    .grid-col.span-3 {
      grid-column: span 1;
    }
  }
</style>
