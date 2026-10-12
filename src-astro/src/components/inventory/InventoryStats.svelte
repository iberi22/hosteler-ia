<script lang="ts">
  // InventoryStats.svelte — H1.04 — @swal/ui cards for inventory overview
  import { Card, Badge } from '@swal/ui';
  import type { InventoryItem } from '../../stores/inventory.svelte';

  interface Props {
    items?: InventoryItem[];
    lastUpdated?: number | null;
  }

  let { items = [], lastUpdated = null }: Props = $props();

  const totalItems = $derived(items.length);
  const lowStockCount = $derived(items.filter(i => i.stock <= i.minStock).length);
  const totalValue = $derived(
    items.reduce((acc, i) => acc + i.stock * i.costPerUnit, 0)
  );
  const lastUpdatedStr = $derived(
    lastUpdated
      ? new Date(lastUpdated).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : '—'
  );

  function formatCurrency(v: number): string {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
  }
</script>

<div class="inventory-stats">
  <Card variant="default" padding="md">
    <div class="stat-card">
      <span class="stat-label">Total artículos</span>
      <span class="stat-value">{totalItems}</span>
    </div>
  </Card>

  <Card variant="default" padding="md">
    <div class="stat-card">
      <span class="stat-label">Stock bajo</span>
      <div class="stat-value-row">
        <span class="stat-value" class:danger={lowStockCount > 0}>{lowStockCount}</span>
        {#if lowStockCount > 0}
          <Badge variant="danger" size="sm">Alert</Badge>
        {/if}
      </div>
    </div>
  </Card>

  <Card variant="default" padding="md">
    <div class="stat-card">
      <span class="stat-label">Valor inventario</span>
      <span class="stat-value highlight">{formatCurrency(totalValue)}</span>
    </div>
  </Card>

  <Card variant="default" padding="md">
    <div class="stat-card">
      <span class="stat-label">Última actualización</span>
      <span class="stat-value muted">{lastUpdatedStr}</span>
    </div>
  </Card>
</div>

<style>
  .inventory-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--swal-text-secondary, #94a3b8);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--swal-text, #e2e8f0);
    line-height: 1.2;
  }

  .stat-value.danger {
    color: var(--swal-danger, #f87171);
  }

  .stat-value.highlight {
    color: var(--swal-neon-cyan, #22d3ee);
  }

  .stat-value.muted {
    font-size: 1rem;
    color: var(--swal-text-secondary, #94a3b8);
    font-weight: 500;
  }

  .stat-value-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
