<!-- LowStockPanel.svelte — Analytics low stock warning panel -->
<script lang="ts">
  import { Card, Badge } from '@swal/ui';
  import type { LowStockSummary } from '../../lib/analytics';

  interface Props {
    items: LowStockSummary[];
  }

  let { items }: Props = $props();

  const criticalCount = $derived(items.filter((i) => i.stock === 0).length);

  function stockVariant(stock: number, minStock: number): 'danger' | 'warning' {
    if (stock === 0 || stock <= minStock * 0.5) return 'danger';
    return 'warning';
  }
</script>

<Card variant="default">
  <div class="low-stock-container">
    <div class="panel-header">
      <div class="title-group">
        <h3 class="panel-title">Alertas de Inventario</h3>
        {#if criticalCount > 0}
          <Badge variant="danger" size="sm">{criticalCount} sin stock</Badge>
        {/if}
      </div>
      <Badge variant={items.length > 0 ? 'warning' : 'success'}>
        {items.length} ítems
      </Badge>
    </div>

    {#if items.length === 0}
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">✓</span>
        <span>Inventario con niveles adecuados. Sin alertas.</span>
      </div>
    {:else}
      <ul class="stock-list" role="list">
        {#each items as item}
          {@const variant = stockVariant(item.stock, item.minStock)}
          <li class="stock-row" role="listitem">
            <div class="stock-info">
              <span class="stock-name">{item.name}</span>
              <span class="stock-sku">{item.sku}</span>
            </div>

            <div class="stock-metric">
              <div class="stock-badge-wrapper">
                <Badge variant={variant} size="sm">
                  {item.stock} / {item.minStock} {item.unit}
                </Badge>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</Card>

<style>
  .low-stock-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--swal-border, rgba(255, 255, 255, 0.08));
    padding-bottom: 0.75rem;
  }

  .title-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .panel-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .empty-state {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1.5rem 0.5rem;
    color: var(--swal-text-secondary, #64748b);
    font-size: 0.875rem;
  }

  .empty-icon {
    color: var(--swal-neon-green, #4ade80);
    font-weight: 700;
  }

  .stock-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .stock-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--swal-card-bg, rgba(255, 255, 255, 0.02));
    border: 1px solid var(--swal-border, rgba(255, 255, 255, 0.05));
    border-radius: 6px;
  }

  .stock-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .stock-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--swal-text, #f1f5f9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stock-sku {
    font-size: 0.75rem;
    font-family: monospace;
    color: var(--swal-text-secondary, #64748b);
  }

  .stock-metric {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .stock-badge-wrapper {
    display: inline-flex;
  }
</style>
