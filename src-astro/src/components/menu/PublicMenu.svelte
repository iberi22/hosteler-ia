<script lang="ts">
  import { domainConfig } from '../../lib/domain.config';
  // PublicMenu.svelte — carta pública de solo lectura + añadir al carrito
  import { onMount } from 'svelte';
  import { Badge, Button } from '@swal/ui';
  import { refreshMenuNutrition } from '../../lib/menuNutritionCache';
  import type { PublicNutrition } from '../../lib/publicMenuNutrition';
  import { addItem, cart } from '../../stores/cart.svelte';
  import { formatCOP } from '../../lib/money';
  import { buildWhatsappMessage, normalizeColombianPhone } from '../../lib/domain.extensions';
  import type { PublicCategory, PublicMenuItem } from '../../lib/publicMenu';

  interface Props {
    restaurantName?: string;
    categories?: PublicCategory[];
    items?: PublicMenuItem[];
    /** Slug de la tienda: se usa en el enlace al checkout y en el mensaje. */
    storeSlug?: string;
    /** WhatsApp del restaurante. Sin numero, el boton se oculta. */
    restaurantPhone?: string;
    baseUrl?: string;
    restaurantId?: string;
    instanceId?: string;
    /** Mesa del QR (`?mesa=N`, ya validada por la pagina). Vacio = "por confirmar". */
    tableLabel?: string;
    /**
     * Pedir los totales nutricionales a `/api/menu-nutrition`. La carta publicada desde un nodo local no
     * tiene recetas en la nube: pedirlos seria una peticion y lecturas de almacenamiento por visita en vano.
     */
    loadNutrition?: boolean;
  }

  let {
    restaurantName = 'Nuestra carta',
    categories = [],
    items = [],
    storeSlug = '',
    restaurantPhone = '',
    baseUrl = '',
    restaurantId = '',
    instanceId = domainConfig.instanceId,
    tableLabel = '',
    loadNutrition = true,
  }: Props = $props();

  let activeCategory = $state<string | null>(null);
  let notice = $state('');
  let nutrition = $state<PublicNutrition>({});
  let excluded = $state<string[]>([]);
  const allergens = $derived([...new Set(items.flatMap(i => nutrition[i.id]?.allergens ?? []))].sort());
  const datasets = $derived([...new Set(items.flatMap(i => nutrition[i.id] ? [nutrition[i.id].dataset] : []))]);
  onMount(() => {
    if (!loadNutrition || (!storeSlug && !restaurantId)) return;
    const query = new URLSearchParams({ instance_id: instanceId });
    query.set(storeSlug ? 'slug' : 'restaurantId', storeSlug || restaurantId);
    let active = true;
    void refreshMenuNutrition(`/api/menu-nutrition?${query}`, data => { if (active) nutrition = data; });
    return () => { active = false; };
  });
  function toggleAllergen(tag: string) {
    excluded = excluded.includes(tag) ? excluded.filter(t => t !== tag) : [...excluded, tag];
  }
  function allergenLabel(tag: string) {
    return tag.replace('gos:allergen/', '').replace(/[_-]/g, ' ');
  }
  function nutrient(value: number | undefined) {
    return value === undefined ? '—' : new Intl.NumberFormat('es', { maximumFractionDigits: 1 }).format(value);
  }

  const visible = $derived(
    items.filter(i => (!activeCategory || i.categoryId === activeCategory)
      && !nutrition[i.id]?.allergens.some(tag => excluded.includes(tag))),
  );

  const cartTotal = $derived(
    cart.items.reduce((sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice, 0),
  );

  /**
   * Pedido por WhatsApp sin API de WhatsApp Business: se genera un enlace
   * wa.me con el mensaje ya escrito. El cliente abre su propia app, confirma y
   * listo. No hace falta onboarding, webhook ni numero verificado por Meta.
   */
  const waLink = $derived.by(() => {
    if (!restaurantPhone || cart.items.length === 0) return '';
    return buildWhatsappMessage({
      restaurantName,
      orderId: `${storeSlug || 'pedido'} ${new Date().toISOString().slice(11, 19)}`,
      tableLabel: tableLabel || 'por confirmar',
      lines: cart.items.map((i: { name: string; quantity: number; unitPrice: number }) => ({
        name: i.name,
        qty: i.quantity,
        unitPrice: i.unitPrice,
      })),
      total: cartTotal,
      ...(baseUrl && storeSlug ? { orderUrl: `${baseUrl}/${storeSlug}/menu` } : {}),
    });
  });

  const waHref = $derived(waLink ? `https://wa.me/${normalizeColombianPhone(restaurantPhone)}?text=${encodeURIComponent(waLink)}` : '');

  function add(menuItem: PublicMenuItem) {
    addItem({ menuItemId: menuItem.id, name: menuItem.name, quantity: 1, unitPrice: menuItem.price });
    notice = `${menuItem.name} añadido`;
    setTimeout(() => (notice = ''), 1500);
  }
</script>

<section class="public-menu">
  <h1>{restaurantName}</h1>
  {#if categories.length > 0}
    <nav class="cats" aria-label="Categorías">
      <button class:active={activeCategory === null} onclick={() => (activeCategory = null)}>Todo</button>
      {#each categories as cat}
        <button class:active={activeCategory === cat.id} onclick={() => (activeCategory = cat.id)}>
          {cat.name}
        </button>
      {/each}
    </nav>
  {/if}
  {#if datasets.length > 0}
    <fieldset class="allergen-filter">
      <legend>Filtrar por alérgenos</legend>
      <p>{allergens.length ? 'Ocultar platos con estos alérgenos declarados:' : 'No hay etiquetas de alérgenos declaradas en los datos disponibles.'}</p>
      {#each allergens as tag}
        <label><input type="checkbox" checked={excluded.includes(tag)} onchange={() => toggleAllergen(tag)} /> {allergenLabel(tag)}</label>
      {/each}
    </fieldset>
  {/if}
  {#if datasets.length > 0}
    <p class="nutrition-note">Los datos pueden ser parciales. Sin etiquetas no significa sin alérgenos.</p>
  {/if}
  {#if notice}
    <p class="notice" role="status">{notice}</p>
  {/if}
  <ul class="items">
    {#each visible as item}
      <li class="item">
        <div>
          <strong>{item.name}</strong>
          {#if item.description}<p>{item.description}</p>{/if}
          {#if nutrition[item.id]}
            {@const data = nutrition[item.id]}
            {#if Object.keys(data.nutrition).length > 0}
              <dl class="nutrition-card" aria-label={`Nutrición por porción de ${item.name}`}>
                <div><dt>kcal</dt><dd>{nutrient(data.nutrition.calories ?? data.nutrition.energy_kcal)}</dd></div>
                <div><dt>Proteína</dt><dd>{nutrient(data.nutrition.protein_g)} g</dd></div>
                <div><dt>Carbohidratos</dt><dd>{nutrient(data.nutrition.carbs_g)} g</dd></div>
                <div><dt>Grasa</dt><dd>{nutrient(data.nutrition.fat_g)} g</dd></div>
              </dl>
            {/if}
            {#if data.partial}<p class="nutrition-note">parcial: {data.linked} de {data.total} ingredientes vinculados</p>{/if}
            <div class="allergen-chips">
              {#each data.allergens as tag}<Badge>{allergenLabel(tag)}</Badge>{/each}
            </div>
          {/if}
        </div>
        <div class="row">
          <span class="price">{formatCOP(item.price)}</span>
          <!-- Boton del core (tokens Bone, 44px de objetivo tactil, anillo de foco). El nombre accesible
              "Añadir <plato>" lo usan los E2E y el smoke: no cambiarlo. -->
          <Button variant="primary" size="md" onclick={() => add(item)} aria-label={`Añadir ${item.name}`}>Añadir</Button>
        </div>
      </li>
    {/each}
  </ul>
  {#if visible.length === 0}
    <p>Carta vacía por ahora.</p>
  {/if}

  {#if datasets.length > 0}
    <p class="nutrition-note">Datos nutricionales: GOS (<a href="https://gos.swal.network">gos.swal.network</a>)</p>
    {#each datasets as dataset}<p class="dataset">Dataset: {dataset}</p>{/each}
  {/if}
  {#if cart.items.length > 0}
    <!--
      Espaciador: la barra de pedido es `position: fixed`, asi que no ocupa
      layout. Sin este bloque el ULTIMO plato de la carta queda debajo de la
      barra y su boton "Anadir" es inclicable. El padding del contenedor solo
      ayuda tras hacer scroll; esto resuelve el estado en reposo.
    -->
    <div class="cart-spacer" aria-hidden="true"></div>
    <div class="cart-bar" role="region" aria-label="Tu pedido">
      <div class="cart-summary">
        <span>{cart.items.length} {cart.items.length === 1 ? 'producto' : 'productos'}</span>
        <strong>{formatCOP(cartTotal)}</strong>
      </div>
      {#if waHref}
        <a class="wa-btn" href={waHref} target="_blank" rel="noopener noreferrer">
            Pedir por WhatsApp
        </a>
      {:else}
        <p class="wa-missing">Muéstrale este pedido al mesero</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .nutrition-card { display: flex; flex-wrap: wrap; gap: 0.8rem; margin: 0.8rem 0 0; font-size: 0.8rem; }
  .nutrition-card dt { color: var(--swal-text-secondary); }
  .nutrition-card dd { margin: 0; font-weight: 600; }
  .nutrition-note { font-size: 0.8rem; color: var(--swal-text-secondary); }
  .nutrition-note a { color: inherit; }
  .dataset { font-size: 0.7rem; overflow-wrap: anywhere; color: var(--swal-text-secondary); }
  .allergen-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
  .allergen-filter { border: 1px solid var(--swal-border); border-radius: 0.6rem; margin: 1rem 0; }
  .allergen-filter label { display: inline-flex; align-items: center; gap: 0.3rem; margin: 0.3rem 0.6rem 0.3rem 0; }
  .allergen-filter p { font-size: 0.8rem; }
  .public-menu { max-width: 40rem; margin: 0 auto; padding: 1.5rem; }
  /*
   * La barra de pedido es `position: fixed`, asi que no ocupa layout. Este
   * bloque reserva su alto para que el ULTIMO plato de la carta no quede
   * debajo de ella con su boton "Anadir" inclicable.
   */
  .cart-spacer { height: 7.5rem; }
  .cats { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0; }
  .cats button { padding: 0.4rem 0.8rem; border-radius: 999px; border: 1px solid var(--swal-border, #1e293b); background: transparent; color: inherit; cursor: pointer; }
  .cats button.active { background: var(--swal-accent, #06b6d4); color: var(--swal-bg); border-color: transparent; }
  .items { list-style: none; display: flex; flex-direction: column; gap: 0.75rem; padding: 0; }
  .item { display: flex; justify-content: space-between; gap: 1rem; padding: 0.9rem; border: 1px solid var(--swal-border, #1e293b); border-radius: 0.6rem; }
  .row { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
  .price { font-weight: 700; }
  .notice { color: var(--swal-accent, #06b6d4); }

  /*
   * La barra de pedido va FIJA, no sticky: `main` y `body` tienen
   * `overflow-y: auto` para evitar scroll lateral en movil, y un ancestro con
   * overflow distinto de `visible` anula `position: sticky` (el elemento se
   * queda pegado al contenedor, no al viewport, y el CTA de pedir — el boton
   * mas importante de la carta — queda fuera de pantalla).
   */
  .cart-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
    border: 0;
    border-top: 1px solid var(--swal-border, #1e293b);
    background: var(--swal-bg-surface, #111827);
    box-shadow: 0 -6px 20px rgb(0 0 0 / 0.45);
  }
  .cart-summary { display: flex; align-items: baseline; gap: 0.6rem; font-size: 0.9rem; opacity: 0.85; }
  .cart-summary strong { font-size: 1.1rem; opacity: 1; }

  .wa-btn {
    display: inline-block;
    padding: 0.65rem 1.1rem;
    border-radius: 999px;
    background: #25d366;
    color: #052e16;
    font-weight: 700;
    text-decoration: none;
    white-space: nowrap;
  }
  .wa-btn:hover { background: #1fbe59; }

  .wa-missing { margin: 0; font-size: 0.95rem; font-weight: 600; text-align: center; }
</style>
