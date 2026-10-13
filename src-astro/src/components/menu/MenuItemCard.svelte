<script lang="ts">
  // MenuItemCard.svelte — H1.05 + H4.03
  import type { MenuItem } from '../../stores/menu.svelte';
  import type { RecipeLine } from '../../lib/recipes';
  import { formatCOP } from '../../lib/money';

  interface Props {
    item: MenuItem;
    onEdit?: (item: MenuItem) => void;
    onToggle?: (id: string) => void;
  }

  let { item, onEdit, onToggle }: Props = $props();

  const recipe = $derived<RecipeLine[]>(
    Array.isArray((item as Record<string, unknown>).recipe)
      ? ((item as Record<string, unknown>).recipe as RecipeLine[])
      : []
  );

  function formatPrice(p: number): string {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(p);
  }
</script>

<article class="menu-card" class:unavailable={!item.isAvailable}>
  <div class="card-header">
    <div class="card-title-row">
      <h3 class="item-name">{item.name}</h3>
      {#if !item.isAvailable}
        <span class="badge badge-danger">Agotado</span>
      {:else if item.tags.includes('vegetariano')}
        <span class="badge badge-success">Veg</span>
      {/if}
    </div>
    <span class="item-price">{formatPrice(item.price)}</span>
  </div>

  {#if item.description}
    <p class="item-desc">{item.description}</p>
  {/if}

  {#if recipe.length > 0}
    <div class="recipe-summary">
      <span class="recipe-label">Receta:</span>
      <span class="recipe-count">{recipe.length} {recipe.length === 1 ? 'ingrediente' : 'ingredientes'}</span>
    </div>
  {/if}

  {#if item.tags.length > 0}
    <div class="item-tags">
      {#each item.tags as tag}
        <span class="tag">{tag}</span>
      {/each}
    </div>
  {/if}

  <div class="card-footer">
    <span class="item-sku">{item.sku}</span>
    <div class="card-actions">
      <button
        class="action-btn"
        onclick={() => onToggle?.(item.id)}
        title={item.isAvailable ? 'Marcar agotado' : 'Marcar disponible'}
        aria-label={item.isAvailable ? 'Marcar agotado' : 'Marcar disponible'}
      >
        <span aria-hidden="true">{item.isAvailable ? '◉' : '◎'}</span>
      </button>
      <button class="action-btn" onclick={() => onEdit?.(item)} title="Editar" aria-label="Editar">
        <span aria-hidden="true">✎</span>
      </button>
    </div>
  </div>
</article>

<style>
  .menu-card {
    background: var(--swal-card-bg, rgba(255,255,255,0.04));
    border: 1px solid var(--swal-border, rgba(255,255,255,0.08));
    border-radius: 10px;
    padding: 0.875rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    transition: border-color 150ms, opacity 150ms;
  }

  .menu-card:hover {
    border-color: var(--swal-neon-cyan, #22d3ee);
  }

  .menu-card.unavailable {
    opacity: 0.55;
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .item-name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .item-price {
    font-size: 1rem;
    font-weight: 700;
    color: var(--swal-neon-cyan, #22d3ee);
    white-space: nowrap;
  }

  .item-desc {
    font-size: 0.8125rem;
    color: var(--swal-text-secondary, #94a3b8);
    margin: 0;
    line-height: 1.4;
  }

  .recipe-summary {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--swal-text-secondary, #94a3b8);
    background: rgba(255,255,255,0.03);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    border: 1px dashed var(--swal-border, rgba(255,255,255,0.1));
  }

  .recipe-label {
    font-weight: 600;
    color: var(--swal-neon-cyan, #22d3ee);
  }

  .item-tags {
    display: flex;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .badge {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-weight: 600;
  }

  .badge-danger {
    background: rgba(248,113,113,0.15);
    color: var(--swal-danger, #f87171);
  }

  .badge-success {
    background: rgba(74,222,128,0.15);
    color: var(--swal-neon-green, #4ade80);
  }

  .tag {
    font-size: 0.6875rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: rgba(74,222,128,0.15);
    color: var(--swal-neon-green, #4ade80);
    font-weight: 500;
  }

  .item-sku {
    font-size: 0.6875rem;
    font-family: monospace;
    color: var(--swal-text-secondary, #64748b);
  }

  .card-actions {
    display: flex;
    gap: 0.25rem;
  }

  .action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem 0.375rem;
    font-size: 0.875rem;
    color: var(--swal-text-secondary, #64748b);
    border-radius: 4px;
    transition: color 150ms, background 150ms;
  }

  .action-btn:hover {
    color: var(--swal-text, #e2e8f0);
    background: var(--swal-hover-bg, rgba(255,255,255,0.06));
  }
</style>
