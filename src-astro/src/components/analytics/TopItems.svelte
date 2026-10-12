<!-- TopItems.svelte — Analytics top 5 dishes panel -->
<script lang="ts">
  import { Card, Badge } from '@swal/ui';
  import type { TopItemSummary } from '../../lib/analytics';
  import { formatCOP } from '../../lib/money';

  interface Props {
    items: TopItemSummary[];
  }

  let { items }: Props = $props();

  const maxQty = $derived(
    items.length > 0 ? Math.max(...items.map((i) => i.qty)) : 1
  );
</script>

<Card variant="default">
  <div class="top-items-container">
    <div class="panel-header">
      <h3 class="panel-title">Platos Más Vendidos</h3>
      <span class="panel-subtitle">Top 5 por cantidad</span>
    </div>

    {#if items.length === 0}
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">◈</span>
        <span>Sin ventas registradas aún.</span>
      </div>
    {:else}
      <ul class="items-list" role="list">
        {#each items as item, index}
          {@const pct = Math.min(100, Math.round((item.qty / maxQty) * 100))}
          <li class="item-row" role="listitem">
            <div class="rank-badge">
              <Badge variant={index === 0 ? 'warning' : 'default'} size="sm">
                #{index + 1}
              </Badge>
            </div>

            <div class="item-details">
              <div class="item-meta">
                <span class="item-name">{item.name}</span>
                <span class="item-revenue">{formatCOP(item.revenue)}</span>
              </div>

              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: {pct}%"></div>
              </div>
            </div>

            <div class="item-qty">
              <span class="qty-num">{item.qty}</span>
              <span class="qty-unit">uds</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</Card>

<style>
  .top-items-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    border-bottom: 1px solid var(--swal-border, rgba(255, 255, 255, 0.08));
    padding-bottom: 0.75rem;
  }

  .panel-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .panel-subtitle {
    font-size: 0.75rem;
    color: var(--swal-text-secondary, #94a3b8);
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
    color: var(--swal-neon-cyan, #22d3ee);
  }

  .items-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .rank-badge {
    flex-shrink: 0;
    width: 2rem;
  }

  .item-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .item-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
  }

  .item-name {
    font-weight: 600;
    color: var(--swal-text, #f1f5f9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-revenue {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--swal-text-secondary, #94a3b8);
  }

  .progress-bar-bg {
    width: 100%;
    height: 6px;
    background: var(--swal-border, rgba(255, 255, 255, 0.08));
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--swal-neon-cyan, #22d3ee);
    border-radius: 3px;
    transition: width 300ms ease;
  }

  .item-qty {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
    min-width: 2.5rem;
  }

  .qty-num {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--swal-text, #f8fafc);
  }

  .qty-unit {
    font-size: 0.6875rem;
    color: var(--swal-text-secondary, #64748b);
  }
</style>
