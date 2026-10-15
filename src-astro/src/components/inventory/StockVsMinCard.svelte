<script lang="ts">
  // StockVsMinCard.svelte — stock actual frente al minimo configurado (dato real, sin prediccion).
  import { Card, Badge } from '@swal/ui';
  import type { InventoryItem } from '../../stores/inventory.svelte';
  import { stockVsMin, type StockLevel } from '../../lib/stockVsMin';

  interface Props {
    items?: InventoryItem[];
  }

  let { items = [] }: Props = $props();

  const rows = $derived(stockVsMin(items, 5));

  function levelColor(l: StockLevel): string {
    if (l === 'critical') return 'var(--swal-danger, #f87171)';
    if (l === 'low') return 'var(--swal-warning, #fbbf24)';
    return 'var(--swal-text-secondary, #64748b)';
  }

  function levelVariant(l: StockLevel): 'danger' | 'warning' | 'default' {
    if (l === 'critical') return 'danger';
    if (l === 'low') return 'warning';
    return 'default';
  }

  const levelLabel: Record<StockLevel, string> = { critical: 'Crítico', low: 'Bajo', ok: 'OK' };
</script>

<Card variant="default" padding="none">
  <div class="svm-header">
    <h3 class="svm-title">Stock vs. mínimo</h3>
  </div>

  {#if rows.length === 0}
    <div class="svm-empty">
      <span>Ningún insumo tiene mínimo configurado</span>
    </div>
  {:else}
    <ul class="svm-list" role="list">
      {#each rows as { item, level }}
        <li class="svm-item" role="listitem">
          <div class="svm-item-info">
            <span class="svm-item-name">{item.name}</span>
            <span class="svm-item-sku">{item.sku}</span>
          </div>
          <div class="svm-days" style="color: {levelColor(level)}">
            <span class="svm-qty">{item.stock} / {item.minStock} {item.unit}</span>
          </div>
          <Badge variant={levelVariant(level)} size="sm">{levelLabel[level]}</Badge>
        </li>
      {/each}
    </ul>
    <div class="svm-footer">
      <span class="svm-disclaimer">Stock actual frente al mínimo configurado en cada insumo</span>
    </div>
  {/if}
</Card>

<style>
  .svm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.08));
  }

  .svm-title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .svm-empty {
    padding: 1.5rem 1rem;
    text-align: center;
    color: var(--swal-text-secondary, #64748b);
    font-size: 0.875rem;
  }

  .svm-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .svm-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .svm-item:last-child {
    border-bottom: none;
  }

  .svm-item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .svm-item-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--swal-text, #e2e8f0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .svm-item-sku {
    font-size: 0.6875rem;
    font-family: monospace;
    color: var(--swal-text-secondary, #64748b);
  }

  .svm-days {
    min-width: 60px;
    text-align: right;
  }

  .svm-qty {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .svm-footer {
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .svm-disclaimer {
    font-size: 0.6875rem;
    color: var(--swal-text-secondary, #64748b);
    font-style: italic;
  }
</style>
