<script lang="ts">
  // PublishCard.svelte — publicar la carta desde este equipo (NODO-LOCAL.md §2.5).
  // La primera publicacion de un enlace necesita el codigo de activacion que entrega SWAL; las siguientes
  // solo la firma de la llave del restaurante. La llamada real la atiende el Worker (frente 2).
  import { onMount } from 'svelte';
  import { getSettings } from '../../lib/local/localDb';
  import { publicMenuUrl } from '../../lib/local/localMode';
  import { buildLocalPublicMenu, publishMenu, type PublishResult } from '../../lib/local/publish';

  interface Props {
    onPublished?: (url: string) => void;
    /** false cuando la pantalla ya tiene un titulo "Publica tu carta" (onboarding). */
    showTitle?: boolean;
  }
  let { onPublished, showTitle = true }: Props = $props();

  let slug = $state('');
  let hasPhone = $state(false);
  let dishes = $state(0);
  let categories = $state(0);
  let publishedSlug = $state<string | undefined>(undefined);
  let lastPublishedAt = $state<string | undefined>(undefined);
  let activationCode = $state('');
  let busy = $state(false);
  let result = $state<PublishResult | null>(null);
  let loaded = $state(false);

  const firstTime = $derived(!publishedSlug || publishedSlug !== slug);

  async function refresh() {
    const menu = await buildLocalPublicMenu();
    slug = menu?.restaurant.slug ?? '';
    hasPhone = Boolean(menu?.restaurant.phone);
    dishes = menu?.items.length ?? 0;
    categories = menu?.categories.length ?? 0;
    const settings = await getSettings();
    publishedSlug = settings.publishedSlug;
    lastPublishedAt = settings.lastPublishedAt;
  }

  onMount(async () => {
    try {
      await refresh();
    } finally {
      loaded = true;
    }
  });

  async function publish(e: Event) {
    e.preventDefault();
    busy = true;
    result = null;
    try {
      result = await publishMenu({ activationCode: firstTime ? activationCode : undefined });
      await refresh();
      if (result.ok) onPublished?.(result.url);
    } finally {
      busy = false;
    }
  }

  function fmt(iso?: string) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<section class="l-card" aria-labelledby={showTitle ? 'pub-title' : undefined} aria-label={showTitle ? undefined : 'Publicar carta'}>
  {#if showTitle}<h2 id="pub-title">Publica tu carta</h2>{/if}
  {#if !loaded}
    <p>Cargando…</p>
  {:else if !slug}
    <p>Primero completa los datos de tu local en <a href="/local/ajustes/">Mi local</a>.</p>
  {:else}
    <p>
      Tu carta queda en <strong class="l-mono">{publicMenuUrl(slug).replace('https://', '')}</strong> para que tus
      clientes la abran con el QR, aunque este equipo esté apagado. Los pedidos te llegan por WhatsApp.
    </p>
    <ul class="facts">
      <li>Se publican <strong>{dishes} {dishes === 1 ? 'plato' : 'platos'}</strong> en {categories} {categories === 1 ? 'categoría' : 'categorías'}: solo los visibles, disponibles y con precio.</li>
      <li>Nunca se publican recetas, costos, inventario ni proveedores.</li>
      {#if lastPublishedAt}<li>Última publicación: {fmt(lastPublishedAt)}. Si cambias precios, vuelve a publicar.</li>{/if}
    </ul>
    {#if !hasPhone}
      <p class="l-alert l-alert-warn">Tu carta no tiene WhatsApp: el botón “Pedir por WhatsApp” no aparecerá. Agrégalo en <a href="/local/ajustes/">Mi local</a>.</p>
    {/if}

    <form class="form" onsubmit={publish}>
      {#if firstTime}
        <div class="l-field">
          <label for="activation">Código de activación</label>
          <input id="activation" class="l-input l-mono" autocomplete="off" autocapitalize="characters" spellcheck="false" bind:value={activationCode} aria-describedby="activation-help" />
          <p id="activation-help" class="l-help">
            La primera vez que publicas necesitas el código que te entrega SWAL. Con él tu enlace queda amarrado a la llave de
            este equipo y nadie más puede publicar en su nombre.
          </p>
        </div>
      {/if}
      <button type="submit" class="l-btn l-btn-primary" disabled={busy || dishes === 0 || (firstTime && !activationCode.trim())}>
        {busy ? 'Publicando…' : firstTime ? 'Publicar carta' : 'Volver a publicar'}
      </button>
      {#if dishes === 0}<p class="l-help">Agrega al menos un plato con precio para poder publicar.</p>{/if}
    </form>

    {#if result}
      {#if result.ok}
        <p class="l-alert l-alert-ok" role="status">Carta publicada: <a href={result.url} target="_blank" rel="noopener noreferrer">{result.url.replace('https://', '')}</a></p>
      {:else}
        <p class={result.reason === 'no-disponible' || result.reason === 'sin-red' ? 'l-alert l-alert-warn' : 'l-alert l-alert-error'} role="alert" data-testid="publish-error">{result.message}</p>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .facts { display: flex; flex-direction: column; gap: 0.25rem; padding-left: 1.125rem; }
  .form { display: flex; flex-direction: column; gap: 0.75rem; align-items: flex-start; }
  .form .l-field { width: 100%; }
</style>
