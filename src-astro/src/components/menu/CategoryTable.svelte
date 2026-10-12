<script lang="ts">
  // CategoryTable.svelte — H1.05 (no @swal/ui deps)
  import type { MenuCategory } from '../../stores/menu.svelte';

  interface Props {
    categories: MenuCategory[];
    onEdit?: (cat: MenuCategory) => void;
    onDelete?: (id: string) => void;
    onToggleActive?: (id: string) => void;
  }

  let { categories, onEdit, onDelete, onToggleActive }: Props = $props();

  let sortOrder = $state<'asc' | 'desc'>('asc');
  const sorted = $derived(
    [...categories].sort((a, b) =>
      sortOrder === 'asc' ? a.sortOrder - b.sortOrder : b.sortOrder - a.sortOrder
    )
  );

  function toggleSort() {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
  }
</script>

<div class="cat-table-wrapper">
  <table class="cat-table" aria-label="Categorías del menú">
    <thead>
      <tr>
        <th class="sortable" onclick={toggleSort} role="columnheader" aria-sort={sortOrder === 'asc' ? 'ascending' : 'descending'}>
          # <span class="sort-icon">{sortOrder === 'asc' ? '↑' : '↓'}</span>
        </th>
        <th>Nombre</th>
        <th>Descripción</th>
        <th>Estado</th>
        <th class="actions-col">Acciones</th>
      </tr>
    </thead>
    <tbody>
      {#each sorted as cat (cat.id)}
        <tr class:inactive={!cat.isActive}>
          <td class="col-order">{cat.sortOrder}</td>
          <td class="col-name">{cat.name}</td>
          <td class="col-desc">{cat.description ?? '—'}</td>
          <td>
            <span class="status-badge" class:active={cat.isActive}>
              {cat.isActive ? 'Activa' : 'Inactiva'}
            </span>
          </td>
          <td class="col-actions">
            <button class="icon-btn" onclick={() => onToggleActive?.(cat.id)} title={cat.isActive ? 'Desactivar' : 'Activar'}>
              {cat.isActive ? '◉' : '◎'}
            </button>
            <button class="icon-btn" onclick={() => onEdit?.(cat)} title="Editar">✎</button>
            <button class="icon-btn danger" onclick={() => onDelete?.(cat.id)} title="Eliminar">✕</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .cat-table-wrapper { overflow-x: auto; border-radius: 10px; border: 1px solid var(--swal-border, rgba(255,255,255,0.08)); }
  .cat-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  thead { background: rgba(255,255,255,0.03); }
  th {
    text-align: left; padding: 0.625rem 0.875rem;
    font-weight: 600; color: var(--swal-text-secondary, #94a3b8);
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.08));
    white-space: nowrap; user-select: none;
  }
  th.sortable { cursor: pointer; }
  th.sortable:hover { color: var(--swal-text, #e2e8f0); }
  .sort-icon { font-size: 0.6875rem; margin-left: 0.25rem; }
  td { padding: 0.6875rem 0.875rem; color: var(--swal-text, #e2e8f0); border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.05)); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr.inactive td { opacity: 0.5; }
  .col-order { font-family: monospace; font-size: 0.75rem; color: var(--swal-text-secondary, #64748b); width: 2rem; }
  .col-desc { color: var(--swal-text-secondary, #94a3b8); font-size: 0.8125rem; }
  .col-actions { display: flex; gap: 0.25rem; justify-content: flex-end; width: 7rem; }
  .actions-col { text-align: right; }
  .status-badge {
    font-size: 0.6875rem; padding: 0.125rem 0.5rem;
    border-radius: 999px; font-weight: 600;
    background: rgba(100,116,139,0.2); color: var(--swal-text-secondary, #94a3b8);
  }
  .status-badge.active { background: rgba(74,222,128,0.15); color: var(--swal-neon-green, #4ade80); }
  .icon-btn { background: none; border: none; cursor: pointer; font-size: 0.875rem; padding: 0.25rem 0.375rem; border-radius: 4px; color: var(--swal-text-secondary, #64748b); transition: color 150ms, background 150ms; }
  .icon-btn:hover { color: var(--swal-text, #e2e8f0); background: rgba(255,255,255,0.06); }
  .icon-btn.danger:hover { color: var(--swal-danger, #f87171); background: rgba(248,113,113,0.1); }
</style>
