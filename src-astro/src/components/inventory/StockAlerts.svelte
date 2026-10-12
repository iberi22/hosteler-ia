<script lang="ts">
  // StockAlerts.svelte — H1.04 — list of low/critical stock items
  import { Card, Badge, Button } from '@swal/ui';
  import type { InventoryItem } from '../../stores/inventory.svelte';

  interface Props {
    items?: InventoryItem[];
    onAdjust?: (item: InventoryItem) => void;
  }

  let { items = [], onAdjust }: Props = $props();

  const lowStock = $derived(items.filter(i => i.stock <= i.minStock));
  const critical = $derived(items.filter(i => i.stock === 0));

  function stockPct(item: InventoryItem): number {
    if (item.minStock === 0) return 100;
    return Math.min(100, Math.round((item.stock / item.minStock) * 100));
  }

  function stockVariant(item: InventoryItem): 'danger' | 'warning' | 'success' {
    if (item.stock === 0) return 'danger';
    if (item.stock <= item.minStock * 0.5) return 'danger';
    if (item.stock <= item.minStock) return 'warning';
    return 'success';
  }
</script>

<Card variant="default" padding="none">
  <div class="alerts-header">
    <h3 class="alerts-title">Alertas de Stock</h3>
    <div class="alerts-meta">
      {#if critical.length > 0}
        <Badge variant="danger" size="sm">{critical.length} críticos</Badge>
      {/if}
      {#if lowStock.length > 0}
        <Badge variant="warning" size="sm">{lowStock.length} bajos</Badge>
      {/if}
    </div>
  </div>

  {#if lowStock.length === 0}
    <div class="alerts-empty">
      <span class="empty-icon" aria-hidden="true">◉</span>
      <span>Sin alertas — inventario saludable</span>
    </div>
  {:else}
    <ul class="alerts-list" role="list">
      {#each lowStock as item}
        {@const pct = stockPct(item)}
        {@const variant = stockVariant(item)}
        <li class="alert-item" role="listitem">
          <div class="alert-info">
            <div class="alert-name">{item.name}</div>
            <div class="alert-meta">
              <span class="alert-sku">{item.sku}</span>
              {#if item.category}
                <span class="alert-cat">· {item.category}</span>
              {/if}
            </div>
          </div>
          <div class="alert-stock">
            <div class="stock-numbers">
              <span class="stock-current" class:danger={variant === 'danger'} class:warning={variant === 'warning'}>
                {item.stock} {item.unit}
              </span>
              <span class="stock-sep">/</span>
              <span class="stock-min">{item.minStock} {item.unit}</span>
            </div>
            <div class="stock-bar">
              <div
                class="stock-fill"
                class:danger={variant === 'danger'}
                class:warning={variant === 'warning'}
                class:success={variant === 'success'}
                style="width: {pct}%"
              ></div>
            </div>
          </div>
          {#if onAdjust}
            <Button
              variant="ghost"
              size="sm"
              onclick={() => onAdjust(item)}
            >
              Ajustar
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Card>

<style>
  .alerts-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.08));
  }

  .alerts-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .alerts-meta {
    display: flex;
    gap: 0.375rem;
  }

  .alerts-empty {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1.5rem 1rem;
    color: var(--swal-text-secondary, #64748b);
    font-size: 0.875rem;
  }

  .empty-icon {
    color: var(--swal-neon-green, #4ade80);
  }

  .alerts-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .alert-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .alert-item:last-child {
    border-bottom: none;
  }

  .alert-info {
    flex: 1;
    min-width: 0;
  }

  .alert-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--swal-text, #e2e8f0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .alert-meta {
    font-size: 0.75rem;
    color: var(--swal-text-secondary, #64748b);
    margin-top: 0.125rem;
  }

  .alert-sku {
    font-family: monospace;
  }

  .alert-stock {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 100px;
    align-items: flex-end;
  }

  .stock-numbers {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    font-size: 0.8125rem;
  }

  .stock-current {
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
  }

  .stock-current.danger { color: var(--swal-danger, #f87171); }
  .stock-current.warning { color: var(--swal-warning, #fbbf24); }

  .stock-sep { color: var(--swal-text-secondary, #64748b); }
  .stock-min { color: var(--swal-text-secondary, #64748b); font-size: 0.75rem; }

  .stock-bar {
    width: 80px;
    height: 4px;
    background: var(--swal-border, rgba(255,255,255,0.1));
    border-radius: 2px;
    overflow: hidden;
  }

  .stock-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 300ms ease;
  }

  .stock-fill.danger { background: var(--swal-danger, #f87171); }
  .stock-fill.warning { background: var(--swal-warning, #fbbf24); }
  .stock-fill.success { background: var(--swal-neon-green, #4ade80); }
</style>
