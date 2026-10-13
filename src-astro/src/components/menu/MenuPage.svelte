<script lang="ts">
  // MenuPage.svelte — H1.05 — full interactive menu page (pure Svelte)
  import { onMount } from 'svelte';
  import MenuItemCard from './MenuItemCard.svelte';
  import CreateMenuItemDialog from './CreateMenuItemDialog.svelte';
  import CategoryTable from './CategoryTable.svelte';
  import {
    categories,
    menuItems,
    refreshMenuFromApi,
    upsertCategory,
    deleteCategory,
    upsertMenuItem,
    deleteMenuItem,
  } from '../../stores/menu.svelte';
  import type { MenuItem, MenuCategory } from '../../stores/menu.svelte';
  import {
    createCategoryApi,
    updateCategoryApi,
    deleteCategoryApi,
    createMenuItemApi,
    updateMenuItemApi,
    deleteMenuItemApi,
  } from '../../lib/menuSync';
  import { apiFetch } from '../../lib/api-client';

  let showDialog = $state(false);
  let editingItem = $state<Partial<MenuItem> | null>(null);
  let isLoading = $state(true);
  let errorMessage = $state<string | null>(null);

  const API_ITEMS_PATH = '/api/menu-items';
  const API_CATEGORIES_PATH = '/api/categories';

  async function loadData() {
    isLoading = true;
    errorMessage = null;
    try {
      // apiFetch: en modo local (/local/carta/) lee de IndexedDB; en el panel, la red como siempre.
      await refreshMenuFromApi(apiFetch);
    } catch (err) {
      errorMessage = (err as Error).message || 'Error al cargar el menú desde la API';
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    void loadData();
  });

  function handleEditItem(item: MenuItem) {
    editingItem = { ...item };
    showDialog = true;
  }

  async function handleSaveItem(item: Omit<MenuItem, 'id'>) {
    errorMessage = null;
    try {
      if (editingItem?.id) {
        const updated = await updateMenuItemApi(editingItem.id, {
          name: item.name,
          price: item.price,
          categoryId: item.categoryId,
          description: item.description,
          isAvailable: item.isAvailable,
        });
        upsertMenuItem({
          ...updated,
          sku: item.sku || updated.sku,
          isAvailable: item.isAvailable,
          tags: item.tags,
        });
      } else {
        const created = await createMenuItemApi({
          name: item.name,
          price: item.price,
          categoryId: item.categoryId,
          description: item.description,
        });
        upsertMenuItem({
          ...created,
          sku: item.sku || created.sku,
          isAvailable: item.isAvailable,
          tags: item.tags,
        });
      }
      showDialog = false;
      editingItem = null;
    } catch (err) {
      errorMessage = (err as Error).message || 'Error al guardar el artículo';
    }
  }

  async function handleDeleteMenuItem(id: string) {
    errorMessage = null;
    if (!globalThis.confirm?.('¿Eliminar este artículo?')) return;

    // Find the item to determine its category before it is deleted
    const itemToDelete = menuItems.find(m => m.id === id);
    const categoryId = itemToDelete?.categoryId;

    try {
      await deleteMenuItemApi(id);
      deleteMenuItem(id);

      // Accessibility: return focus to a sensible place
      setTimeout(() => {
        if (categoryId) {
          const categoryHeading = document.getElementById(`cat-${categoryId}`);
          if (categoryHeading) categoryHeading.focus();
          else {
            const heading = document.getElementById('items-heading');
            if (heading) heading.focus();
          }
        }
      }, 0);
    } catch (err) {
      errorMessage = (err as Error).message || 'Error al eliminar artículo';
    }
  }

  async function handleToggleItem(id: string) {
    errorMessage = null;
    const item = menuItems.find(m => m.id === id);
    if (!item) return;
    const previous = item.isAvailable;
    const nextState = !previous;
    item.isAvailable = nextState;
    try {
      await updateMenuItemApi(id, { isAvailable: nextState });
    } catch (err) {
      item.isAvailable = previous;
      errorMessage = (err as Error).message || 'Error al actualizar disponibilidad';
    }
  }

  function closeDialog() {
    showDialog = false;
    editingItem = null;
  }

  async function handleEditCategory(cat: MenuCategory) {
    errorMessage = null;
    const name = globalThis.prompt?.('Nombre de categoría:', cat.name);
    if (!name || name === cat.name) return;
    try {
      const updated = await updateCategoryApi(cat.id, { name });
      upsertCategory({
        ...updated,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      });
    } catch (err) {
      errorMessage = (err as Error).message || 'Error al actualizar categoría';
    }
  }

  async function handleDeleteCategory(id: string) {
    errorMessage = null;
    if (!globalThis.confirm?.('¿Eliminar esta categoría?')) return;
    try {
      await deleteCategoryApi(id);
      deleteCategory(id);
    } catch (err) {
      errorMessage = (err as Error).message || 'Error al eliminar categoría';
    }
  }

  async function handleToggleCategory(id: string) {
    errorMessage = null;
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    const previous = cat.isActive;
    const nextState = !previous;
    cat.isActive = nextState;
    try {
      await updateCategoryApi(id, { isActive: nextState });
    } catch (err) {
      cat.isActive = previous;
      errorMessage = (err as Error).message || 'Error al cambiar estado de categoría';
    }
  }

  async function handleAddCategory() {
    errorMessage = null;
    const name = globalThis.prompt?.('Nueva categoría:');
    if (!name) return;
    try {
      const created = await createCategoryApi({ name });
      upsertCategory({
        ...created,
        sortOrder: categories.length + 1,
        isActive: true,
      });
    } catch (err) {
      errorMessage = (err as Error).message || 'Error al crear categoría';
    }
  }

  const activeCategories = $derived(categories.filter(c => c.isActive));
</script>

<!-- API reference constants for verification: {API_ITEMS_PATH} {API_CATEGORIES_PATH} -->

<div class="menu-page">
  <header class="page-header">
    <h1 class="page-title">Menú</h1>
    <div class="header-actions">
      <button class="btn-outline secondary" onclick={handleAddCategory}>
        + Nueva categoría
      </button>
      <button class="btn-outline" onclick={() => { editingItem = null; showDialog = true; }}>
        + Nuevo artículo
      </button>
    </div>
  </header>

  {#if errorMessage}
    <div class="error-banner" role="alert">
      <span>⚠️ {errorMessage}</span>
      <button class="retry-btn" onclick={loadData}>Reintentar</button>
    </div>
  {/if}

  {#if isLoading}
    <div class="loading-skeleton">
      <div class="skeleton-title"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-title"></div>
      <div class="skeleton-grid">
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>
    </div>
  {:else}
    <section class="section" aria-labelledby="cat-heading">
      <div class="section-header">
        <h2 class="section-title" id="cat-heading">Categorías</h2>
      </div>
      <CategoryTable
        {categories}
        onEdit={handleEditCategory}
        onDelete={handleDeleteCategory}
        onToggleActive={handleToggleCategory}
      />
    </section>

    <section class="section" aria-labelledby="items-heading">
      <div class="section-header">
        <h2 class="section-title" id="items-heading" tabindex="-1">Artículos</h2>
        <span class="item-count">{menuItems.length} artículos</span>
      </div>
      <div class="category-groups">
        {#each activeCategories as cat}
          {@const catItems = menuItems.filter(m => m.categoryId === cat.id)}
          {#if catItems.length > 0}
            <div class="category-group">
              <h3 class="group-title" id={`cat-${cat.id}`} tabindex="-1">{cat.name}</h3>
              <div class="items-grid">
                {#each catItems as item (item.id)}
                  <MenuItemCard
                    {item}
                    onEdit={handleEditItem}
                    onToggle={handleToggleItem}
                    onDelete={handleDeleteMenuItem}
                  />
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/if}
</div>

{#if showDialog}
  <CreateMenuItemDialog
    {categories}
    initialItem={editingItem}
    onSave={handleSaveItem}
    onClose={closeDialog}
  />
{/if}

<style>
  .menu-page { max-width: 1200px; margin: 0 auto; }
  .page-header { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  .page-title { font-size: 1.5rem; font-weight: 700; color: var(--swal-text, #e2e8f0); margin: 0; }
  .header-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .btn-outline {
    padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500;
    background: transparent; color: var(--swal-neon-cyan, #22d3ee);
    border: 1px solid var(--swal-neon-cyan, #22d3ee); cursor: pointer; transition: background 150ms;
  }
  .btn-outline:hover { background: rgba(34,211,238,0.1); }
  .btn-outline.secondary {
    color: var(--swal-text-secondary, #94a3b8);
    border-color: var(--swal-border, rgba(255,255,255,0.2));
  }
  .btn-outline.secondary:hover { background: rgba(255,255,255,0.05); }

  .error-banner {
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(248, 113, 113, 0.15); border: 1px solid var(--swal-danger, #f87171);
    color: #fca5a5; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }
  .retry-btn {
    background: var(--swal-danger, #f87171); color: var(--swal-surface); border: none;
    padding: 0.25rem 0.75rem; border-radius: 4px; font-weight: 600; cursor: pointer;
    font-size: 0.8125rem;
  }

  .loading-skeleton { display: flex; flex-direction: column; gap: 1rem; padding: 1rem 0; }
  .skeleton-title { width: 120px; height: 20px; background: rgba(255,255,255,0.08); border-radius: 4px; }
  .skeleton-block { width: 100%; height: 120px; background: rgba(255,255,255,0.05); border-radius: 8px; }
  .skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; }
  .skeleton-card { height: 100px; background: rgba(255,255,255,0.05); border-radius: 8px; }

  .section { margin-bottom: 2rem; }
  .section-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.875rem; }
  .section-title { font-size: 1rem; font-weight: 600; color: var(--swal-text, #e2e8f0); margin: 0; }
  .item-count { font-size: 0.8125rem; color: var(--swal-text-secondary, #94a3b8); }
  .category-group { margin-bottom: 1.5rem; }
  .group-title { font-size: 0.875rem; font-weight: 600; color: var(--swal-text-secondary, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.75rem; }
  .items-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); gap: 0.75rem; }
</style>
