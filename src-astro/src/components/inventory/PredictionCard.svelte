<script lang="ts">
  // PredictionCard.svelte — H1.04 — AI stock depletion prediction
  import { Card, Badge } from '@swal/ui';
  import type { InventoryItem } from '../../stores/inventory.svelte';

  interface Props {
    items?: InventoryItem[];
  }

  let { items = [] }: Props = $props();

  interface Prediction {
    item: InventoryItem;
    daysLeft: number | null;
    confidence: 'high' | 'medium' | 'low';
  }

  const predictions = $derived(
    items
      .filter(i => i.stock > 0 && i.minStock > 0)
      .map(item => {
        const dailyUsage = item.minStock * 0.15;
        const days: number | null = dailyUsage > 0 ? Math.round(item.stock / dailyUsage) : null;
        const confidence: Prediction['confidence'] =
          days !== null && days <= 3 ? 'high' :
          days !== null && days <= 7 ? 'medium' : 'low';
        return { item, daysLeft: days, confidence } satisfies Prediction;
      })
      .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
      .slice(0, 5)
  );

  function dayLabel(n: number | null): string {
    if (n === null) return '?';
    if (n === 0) return 'Hoy';
    if (n === 1) return '1 día';
    return `${n} días`;
  }

  function confidenceColor(c: 'high' | 'medium' | 'low'): string {
    if (c === 'high') return 'var(--swal-danger, #f87171)';
    if (c === 'medium') return 'var(--swal-warning, #fbbf24)';
    return 'var(--swal-text-secondary, #64748b)';
  }

  function urgencyBadgeVariant(c: 'high' | 'medium' | 'low'): 'danger' | 'warning' | 'default' {
    if (c === 'high') return 'danger';
    if (c === 'medium') return 'warning';
    return 'default';
  }
</script>

<Card variant="default" padding="none">
  <div class="pred-header">
    <h3 class="pred-title">
      <span class="pred-icon" aria-hidden="true">◬</span>
      Predicción IA — Stock
    </h3>
    <Badge variant="info" size="sm">AI</Badge>
  </div>

  {#if predictions.length === 0}
    <div class="pred-empty">
      <span>Sin datos suficientes para predicción</span>
    </div>
  {:else}
    <ul class="pred-list" role="list">
      {#each predictions as { item, daysLeft, confidence }}
        <li class="pred-item" role="listitem">
          <div class="pred-item-info">
            <span class="pred-item-name">{item.name}</span>
            <span class="pred-item-sku">{item.sku}</span>
          </div>
          <div class="pred-days" style="color: {confidenceColor(confidence)}">
            <span class="days-num">{dayLabel(daysLeft)}</span>
          </div>
          <Badge variant={urgencyBadgeVariant(confidence)} size="sm">
            {confidence === 'high' ? 'Crítico' : confidence === 'medium' ? 'Pronto' : 'OK'}
          </Badge>
        </li>
      {/each}
    </ul>
    <div class="pred-footer">
      <span class="pred-disclaimer">Basado en consumo promedio estimado (15% del stock mínimo/día)</span>
    </div>
  {/if}
</Card>

<style>
  .pred-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.08));
  }

  .pred-title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .pred-icon {
    color: var(--swal-neon-cyan, #22d3ee);
  }

  .pred-empty {
    padding: 1.5rem 1rem;
    text-align: center;
    color: var(--swal-text-secondary, #64748b);
    font-size: 0.875rem;
  }

  .pred-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .pred-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .pred-item:last-child {
    border-bottom: none;
  }

  .pred-item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .pred-item-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--swal-text, #e2e8f0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pred-item-sku {
    font-size: 0.6875rem;
    font-family: monospace;
    color: var(--swal-text-secondary, #64748b);
  }

  .pred-days {
    min-width: 60px;
    text-align: right;
  }

  .days-num {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .pred-footer {
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .pred-disclaimer {
    font-size: 0.6875rem;
    color: var(--swal-text-secondary, #64748b);
    font-style: italic;
  }
</style>
