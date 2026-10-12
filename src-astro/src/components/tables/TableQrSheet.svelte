<script lang="ts">
  // TableQrSheet.svelte — hoja imprimible de QR de mesas (A4, 8 tarjetas por pagina).
  // Reutiliza RealQr (qrcode-generator, en el navegador, sin servidor) y la misma
  // URL que el dialogo de QR de la pagina de mesas: {origen}/table/{qrCode}.
  import { onMount } from 'svelte';
  import { Button } from '@swal/ui';
  import RealQr from '../RealQr.svelte';
  import { api } from '../../lib/api-client';

  type Table = { id: string; number: number; capacity: number; qrCode: string };

  const PER_PAGE = 8;

  let tables = $state<Table[]>([]);
  let restaurantName = $state("Fi'ze");
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);

  const sorted = $derived([...tables].sort((a, b) => a.number - b.number));
  const pages = $derived(
    Array.from({ length: Math.ceil(sorted.length / PER_PAGE) }, (_, i) => sorted.slice(i * PER_PAGE, (i + 1) * PER_PAGE)),
  );

  function tableUrl(t: Table): string {
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
    return `${origin}/table/${t.qrCode}`;
  }

  onMount(async () => {
    try {
      const [tablesRes, restRes] = await Promise.all([api.get('/api/tables'), api.get('/api/restaurants')]);
      if (!tablesRes.ok) {
        const body = (await tablesRes.json().catch(() => ({}))) as { error?: string };
        errorMsg = body.error || `Error ${tablesRes.status}: no se pudieron cargar las mesas`;
        return;
      }
      const data = (await tablesRes.json()) as Table[];
      tables = Array.isArray(data) ? data.filter((t) => t.qrCode) : [];
      if (restRes.ok) {
        const list = (await restRes.json()) as Array<{ name?: string; deleted_at?: string }>;
        const first = Array.isArray(list) ? list.find((r) => !r.deleted_at && r.name) : undefined;
        if (first?.name) restaurantName = first.name;
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error de conexión al cargar las mesas';
    } finally {
      loading = false;
    }
  });
</script>

<div class="qr-sheet">
  <header class="toolbar no-print">
    <div>
      <h1>Imprimir QR de mesas</h1>
      <p>Hoja A4 con 8 tarjetas por página. Recórtalas y pégalas en cada mesa.</p>
    </div>
    <div class="toolbar-actions">
      <Button variant="ghost" href="/dashboard/tables">Volver a mesas</Button>
      <Button variant="primary" onclick={() => window.print()} disabled={loading || sorted.length === 0}>Imprimir</Button>
    </div>
  </header>

  {#if errorMsg}
    <p class="state no-print" role="alert">{errorMsg}</p>
  {:else if loading}
    <p class="state no-print">Cargando mesas...</p>
  {:else if sorted.length === 0}
    <p class="state no-print">No hay mesas todavía. Crea mesas en la página de mesas para generar sus QR.</p>
  {:else}
    {#each pages as page, p (p)}
      <section class="sheet" aria-label={`Hoja ${p + 1}`}>
        {#each page as t (t.id)}
          <article class="qr-card" data-testid="qr-card">
            <p class="rest">{restaurantName}</p>
            <RealQr value={tableUrl(t)} size={140} title={`QR mesa ${t.number}`} />
            <p class="num">Mesa {t.number}</p>
            <p class="hint">Escanea para ver la carta y pedir</p>
          </article>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  .qr-sheet { max-width: 210mm; margin: 0 auto; padding: 1.5rem 1rem; display: grid; gap: 1.25rem; }
  .toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .toolbar h1 { font-size: 1.4rem; font-weight: 800; color: var(--swal-text); }
  .toolbar p { color: var(--swal-text-secondary); font-size: 0.9rem; margin-top: 0.25rem; }
  .toolbar-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .state { padding: 2rem; text-align: center; color: var(--swal-text-muted); border: 1px dashed var(--swal-border); border-radius: 8px; }

  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); grid-auto-rows: 66mm; gap: 0; }
  .qr-card {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.15rem;
    border: 1px dashed var(--swal-border-strong, var(--swal-border)); padding: 3mm; text-align: center;
    break-inside: avoid;
  }
  .rest { font-size: 0.8rem; font-weight: 600; color: var(--swal-text-secondary); }
  .num { font-size: 1.35rem; font-weight: 800; color: var(--swal-text); }
  .hint { font-size: 0.75rem; color: var(--swal-text-secondary); }

  @media print {
    @page { size: A4; margin: 10mm; }
    :global(html), :global(body) { background: white !important; background-image: none !important; color: black !important; }
    :global(body *) { box-shadow: none !important; }
    .no-print { display: none !important; }
    .qr-sheet { max-width: none; padding: 0; gap: 0; display: block; }
    .sheet { break-after: page; page-break-after: always; }
    .sheet:last-child { break-after: auto; page-break-after: auto; }
    .qr-card { border-color: black; }
    .rest, .num, .hint { color: black; }
  }
</style>
