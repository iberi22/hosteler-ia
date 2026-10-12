<script lang="ts">
  // CartaQr.svelte — enlace y QR de la carta publicada, y enlaces por mesa (?mesa=N).
  // El QR se genera en el equipo (RealQr, sin red). La carta publica lee `mesa` (frente 2).
  import { onMount } from 'svelte';
  import RealQr from '../RealQr.svelte';
  import { apiFetch } from '../../lib/api-client';
  import { getSettings, patchSettings } from '../../lib/local/localDb';
  import { publicMenuUrl } from '../../lib/local/localMode';

  const MAX_TABLES = 60;

  let slug = $state('');
  let name = $state('');
  let tables = $state(0);
  let copied = $state<string | null>(null);
  let loaded = $state(false);

  const link = $derived(slug ? publicMenuUrl(slug) : '');
  const tableLinks = $derived(
    slug ? Array.from({ length: Math.max(0, Math.min(MAX_TABLES, tables)) }, (_, i) => ({ n: i + 1, url: publicMenuUrl(slug, i + 1) })) : [],
  );

  onMount(async () => {
    try {
      const res = await apiFetch('/api/restaurants');
      if (res.ok) {
        const list = (await res.json()) as Array<Record<string, unknown>>;
        slug = String(list[0]?.slug ?? '');
        name = String(list[0]?.name ?? '');
      }
      tables = (await getSettings()).tableCount ?? 0;
    } finally {
      loaded = true;
    }
  });

  async function saveTables() {
    tables = Math.max(0, Math.min(MAX_TABLES, Math.floor(Number(tables) || 0)));
    await patchSettings({ tableCount: tables });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = text;
      setTimeout(() => (copied = null), 2000);
    } catch {
      copied = null;
    }
  }
</script>

<section class="l-card" aria-labelledby="qr-title">
  <h2 id="qr-title">QR y enlace de tu carta</h2>
  {#if !loaded}
    <p>Cargando…</p>
  {:else if !slug}
    <p>Primero completa los datos de tu local en <a href="/local/ajustes/">Mi local</a>.</p>
  {:else}
    <p>Imprime este QR o comparte el enlace. Abre tu carta publicada; mientras no la publiques, el comensal verá “Esta carta todavía no está publicada”.</p>
    <div class="qr-main">
      <RealQr value={link} size={208} title={`QR de la carta de ${name}`} />
      <div class="qr-link">
        <span class="l-label">Enlace de tu carta</span>
        <a class="l-mono link" href={link} target="_blank" rel="noopener noreferrer" data-testid="carta-link">{link}</a>
        <div class="l-row" data-no-print>
          <button type="button" class="l-btn" onclick={() => copy(link)}>{copied === link ? 'Copiado' : 'Copiar enlace'}</button>
          <button type="button" class="l-btn" onclick={() => window.print()}>Imprimir</button>
        </div>
      </div>
    </div>

    <div class="l-field" data-no-print>
      <label for="mesas">¿Cuántas mesas tienes?</label>
      <input id="mesas" class="l-input mesas" type="number" min="0" max={MAX_TABLES} inputmode="numeric" bind:value={tables} onchange={saveTables} />
      <p class="l-help">Cada mesa tiene su QR: el pedido por WhatsApp te llega con el número de la mesa.</p>
    </div>

    {#if tableLinks.length > 0}
      <ul class="mesas-grid" aria-label="QR por mesa">
        {#each tableLinks as t (t.n)}
          <li class="mesa">
            <RealQr value={t.url} size={128} title={`QR de la mesa ${t.n}`} />
            <strong>Mesa {t.n}</strong>
            <span class="l-mono small">{t.url.replace('https://', '')}</span>
            <button type="button" class="l-btn small-btn" data-no-print onclick={() => copy(t.url)}>{copied === t.url ? 'Copiado' : 'Copiar'}</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .qr-main { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
  .qr-link { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; flex: 1 1 14rem; }
  .link { color: var(--swal-text); word-break: break-all; font-size: 0.9rem; }
  .mesas { max-width: 8rem; }
  .mesas-grid { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.75rem; }
  .mesa { display: flex; flex-direction: column; align-items: center; gap: 0.375rem; padding: 0.75rem; border: 1px solid var(--swal-border); border-radius: var(--swal-radius, 0.75rem); text-align: center; break-inside: avoid; }
  .mesa strong { color: var(--swal-text); }
  .small { font-size: 0.7rem; color: var(--swal-text-muted); word-break: break-all; }
  .small-btn { min-height: 2.25rem; padding: 0.25rem 0.75rem; font-size: 0.8125rem; }
</style>
