<!-- SalesSummary.svelte — Analytics sales summary panel (displays data from api/orders) -->
<script lang="ts">
  import { Card, Badge } from '@swal/ui';
  import type { SalesSummary } from '../../lib/analytics';
  import { formatCOP } from '../../lib/money';

  interface Props {
    summary: SalesSummary;
  }

  let { summary }: Props = $props();

  const formattedRevenue = $derived(formatCOP(summary.totalRevenue));

  const statusList = $derived(
    Object.entries(summary.statusCounts).map(([status, count]) => ({
      status,
      count,
    }))
  );

  function statusVariant(status: string): 'success' | 'warning' | 'info' | 'danger' | 'default' {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'delivered':
      case 'paid':
        return 'success';
      case 'pending':
      case 'in_progress':
      case 'preparing':
        return 'warning';
      case 'cancelled':
      case 'rejected':
        return 'danger';
      default:
        return 'default';
    }
  }
</script>

<Card variant="default">
  <div class="summary-container">
    <div class="summary-header">
      <h3 class="summary-title">Resumen de Ventas</h3>
      <Badge variant="info">En vivo</Badge>
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <span class="metric-label">Ingresos Totales</span>
        <span class="metric-value revenue">{formattedRevenue}</span>
      </div>

      <div class="metric-card">
        <span class="metric-label">Total Pedidos</span>
        <span class="metric-value">{summary.totalOrders}</span>
      </div>
    </div>

    <div class="status-section">
      <h4 class="status-title">Desglose por Estado</h4>
      {#if statusList.length === 0}
        <p class="empty-text">Sin pedidos registrados hoy.</p>
      {:else}
        <div class="status-pills">
          {#each statusList as item}
            <div class="status-pill">
              <Badge variant={statusVariant(item.status)} size="sm">
                {item.status}: {item.count}
              </Badge>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</Card>

<style>
  .summary-container {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--swal-border, rgba(255, 255, 255, 0.08));
    padding-bottom: 0.75rem;
  }

  .summary-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
  }

  .metric-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.875rem 1rem;
    background: var(--swal-card-bg, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--swal-border, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
  }

  .metric-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--swal-text-secondary, #94a3b8);
  }

  .metric-value {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--swal-text, #f8fafc);
  }

  .metric-value.revenue {
    color: var(--swal-neon-cyan, #22d3ee);
  }

  .status-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .status-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--swal-text-secondary, #94a3b8);
    margin: 0;
  }

  .status-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .status-pill {
    display: inline-flex;
  }

  .empty-text {
    font-size: 0.875rem;
    color: var(--swal-text-secondary, #64748b);
    margin: 0;
  }
</style>
