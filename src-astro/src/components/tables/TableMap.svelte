<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Badge, Button, Input } from '@swal/ui';
  import QRDialog from './QRDialog.svelte';
  import { api } from '../../lib/api-client';

  type Table = {
    id: string;
    number: number;
    capacity: number;
    qrCode: string;
    status?: 'vacant' | 'occupied';
  };

  let { onCountChange = (_count: number) => {}, newOrderBase = null, printHref = '/dashboard/tables/print', printLabel = 'Imprimir QR' } = $props<{
    onCountChange?: (count: number) => void;
    /** Base del flujo de toma (p. ej. `/local/nuevo-pedido/`): si se pasa, cada mesa ofrece
        un enlace "Nuevo pedido" con `?mesa=<id>`. El dashboard no lo pasa y queda igual. */
    newOrderBase?: string | null;
    /** Hoja de QR imprimible. En modo local NO puede ser la del dashboard: `/dashboard/tables/print`
        pide sesion y expulsa al duenno a `/login` (QA pre-entrega 2026-10-13 #2). La pagina local
        pasa `/local/publicar/`, que ya tiene los QR por mesa. */
    printHref?: string;
    /** Texto de la accion de QR (en local apunta a Publicar, no a la hoja del dashboard). */
    printLabel?: string;
  }>();

  let tables = $state<Table[]>([]);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);

  let newNumber = $state<number | ''>('');
  let newCapacity = $state<number | ''>(4);
  let submitting = $state(false);

  let selected = $state<Table | null>(null);
  let open = $state(false);

  async function loadTables() {
    loading = true;
    errorMsg = null;
    try {
      const res = await api.get('/api/tables');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        errorMsg = body.error || `Error ${res.status}: Failed to load tables`;
        return;
      }
      const data = (await res.json()) as Table[];
      tables = Array.isArray(data) ? data : [];
      onCountChange(tables.length);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error de conexión al cargar mesas';
    } finally {
      loading = false;
    }
  }

  async function createTable(e: SubmitEvent) {
    e.preventDefault();
    if (!newNumber || !newCapacity) return;
    submitting = true;
    errorMsg = null;

    try {
      const res = await api.post('/api/tables', {
        number: Number(newNumber),
        capacity: Number(newCapacity),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        errorMsg = body.error || `Error ${res.status}: No se pudo crear la mesa`;
        return;
      }

      const nextNumber = Number(newNumber) + 1;
      newNumber = nextNumber;
      await loadTables();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al crear la mesa';
    } finally {
      submitting = false;
    }
  }

  async function deleteTable(t: Table, event: MouseEvent) {
    event.stopPropagation();
    if (!confirm(`¿Eliminar la Mesa ${t.number}?`)) return;

    errorMsg = null;
    try {
      const res = await api.del(`/api/tables/${t.id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        errorMsg = body.error || `Error ${res.status}: No se pudo eliminar la mesa`;
        return;
      }
      await loadTables();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Error al eliminar la mesa';
    }
  }

  function onSelect(t: Table) {
    selected = t;
    open = true;
  }

  onMount(() => {
    loadTables();
  });
</script>

<div class="tables-manager">
  <div class="header-bar">
    <h2 class="count-title">Mesas <span class="accent">({tables.length})</span></h2>
    {#if tables.length > 0}
      <Button variant="secondary" href={printHref}>{printLabel}</Button>
    {/if}
  </div>

  <form class="inline-form" onsubmit={createTable}>
    <Input
      type="number"
      label="Nº de Mesa"
      placeholder="Nº de Mesa"
      bind:value={newNumber}
      required
      min="1"
    />
    <Input
      type="number"
      label="Capacidad (pax)"
      placeholder="Capacidad (pax)"
      bind:value={newCapacity}
      required
      min="1"
    />
    <Button variant="primary" type="submit" disabled={submitting}>
      {submitting ? 'Añadiendo...' : 'Añadir Mesa'}
    </Button>
  </form>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  {#if loading}
    <div class="state-msg">Cargando mesas...</div>
  {:else if tables.length === 0}
    <div class="state-msg empty">No hay mesas — crea la primera mesa (Mesa 1)</div>
  {:else}
    <div class="map">
      {#each tables as t (t.id)}
        <Card variant="surface" padding="md" onclick={() => onSelect(t)} class="table-card">
          <div class="head">
            <span class="num">Mesa {t.number}</span>
            <div class="head-right">
              <Badge variant={t.status === 'occupied' ? 'warning' : 'success'}>
                {t.status ?? 'vacant'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onclick={(e) => deleteTable(t, e)}
                title="Eliminar mesa"
                class="del-btn"
              >
                ✕
              </Button>
            </div>
          </div>
          <div class="meta">{t.capacity} pax</div>
          {#if newOrderBase}
            <a
              class="order-link"
              href="{newOrderBase}?mesa={encodeURIComponent(t.id)}"
              onclick={(e) => e.stopPropagation()}
            >Nuevo pedido</a>
          {/if}
        </Card>
      {/each}
    </div>
  {/if}
</div>

<QRDialog {open} table={selected} onclose={() => (open = false)} />

<style>
  .tables-manager { display: flex; flex-direction: column; gap: 1rem; }
  .header-bar { display: flex; justify-content: space-between; align-items: center; }
  .count-title { font-size: 1.25rem; font-weight: 700; color: var(--swal-text); margin: 0; }
  .accent { color: var(--swal-accent); }
  .inline-form { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .error-banner { padding: 0.5rem 0.75rem; background: var(--swal-bg-surface); border: 1px solid var(--swal-accent-red, #ef4444); color: var(--swal-accent-red, #ef4444); border-radius: 6px; font-size: 0.85rem; }
  .state-msg { padding: 2rem; text-align: center; color: var(--swal-text-muted); font-size: 0.95rem; }
  .state-msg.empty { border: 1px dashed var(--swal-border); border-radius: 8px; }
  .map { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .head-right { display: flex; align-items: center; gap: 0.25rem; }
  .num { font-weight: 700; color: var(--swal-text); font-family: var(--swal-font-mono); }
  .meta { font-size: 0.8rem; color: var(--swal-text-muted); margin-top: 0.25rem; }
  .order-link {
    display: inline-block; margin-top: 0.4rem; font-size: 0.82rem; font-weight: 600;
    color: var(--swal-accent-cyan); text-decoration: none;
  }
  .order-link:hover { text-decoration: underline; }
  .order-link:focus-visible { outline: 2px solid var(--swal-accent-cyan); outline-offset: 1px; }
  :global(.table-card) { cursor: pointer; }
  :global(.table-card:hover) { border-color: var(--swal-accent); }
  :global(.del-btn) { padding: 0.1rem 0.4rem !important; min-width: auto !important; height: auto !important; color: var(--swal-text-muted); }
  :global(.del-btn:hover) { color: var(--swal-accent-red, #ef4444); }
</style>
