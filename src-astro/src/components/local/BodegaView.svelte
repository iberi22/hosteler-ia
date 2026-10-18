<script lang="ts">

  import {
    openInventorySnapshot,
    buildInventorySnapshot,
    sealInventorySnapshot,
    InventoryExportError,
    type PlainInventorySnapshot,
  } from '../../lib/inventoryExport';
  import { filterRows, isLowStock, ageInDays } from '../../lib/local/bodegaView';

  // State for importing
  let fileInput = $state<HTMLInputElement>();
  let file = $state<File | null>(null);
  let importPassphrase = $state('');
  let isEncrypted = $state(false);
  let importMsg = $state<{ ok: boolean; text: string } | null>(null);
  let importing = $state(false);

  let snapshot = $state<PlainInventorySnapshot | null>(null);
  let filterQuery = $state('');

  let filteredRows = $derived(snapshot ? filterRows(snapshot.items, filterQuery) : []);
  let age = $derived(snapshot ? ageInDays(snapshot.source.exportedAt) : 0);

  // State for exporting
  let exportPassphrase1 = $state('');
  let exportPassphrase2 = $state('');
  let exportPlain = $state(false);
  let exportMsg = $state<{ ok: boolean; text: string } | null>(null);
  let exporting = $state(false);

  let validExport = $derived(exportPlain || (exportPassphrase1.length >= 8 && exportPassphrase1 === exportPassphrase2));

  function onFile() {
    file = fileInput?.files?.[0] || null;
    importMsg = null;
    snapshot = null;
    importPassphrase = '';
    isEncrypted = false;

    if (file) {
      if (file.name.endsWith('.json')) {
        isEncrypted = false; // Plain files usually don't need a passphrase.
      } else {
        isEncrypted = true; // Assuming non-json (like .fize or custom ext) might be encrypted,
        // we'll actually let the parser fail with 'clave' if it is encrypted and no pass is given.
        // But for UI, let's just show it if they check a box or if the first parse fails.
      }

      // Let's eagerly check if it's a known format, if possible.
      const reader = new FileReader();
      reader.onload = async (e) => {
         try {
           const text = e.target?.result as string;
           const peek = JSON.parse(text);
           if (peek.format === 'swal-inventory-export-enc/v1') {
             isEncrypted = true;
           }
         } catch {
           // ignore, maybe not JSON
         }
      };
      reader.readAsText(file);
    }
  }

  function errorText(err: unknown): string {
    if (err instanceof InventoryExportError) {
      if (err.kind === 'formato') return 'Este archivo no tiene el formato correcto de inventario.';
      if (err.kind === 'clave') return 'La clave es incorrecta.';
      if (err.kind === 'alterado') return 'El archivo está dañado o fue alterado.';
      return err.message;
    }
    return (err as Error).message || 'Error desconocido';
  }

  async function loadFile(e: Event) {
    e.preventDefault();
    if (!file) return;
    importing = true;
    importMsg = null;

    try {
      const text = await file.text();
      snapshot = await openInventorySnapshot(text, isEncrypted ? importPassphrase : undefined);
      importMsg = { ok: true, text: 'Inventario cargado correctamente. Solo lectura.' };
    } catch (err) {
      if (err instanceof InventoryExportError && err.kind === 'clave' && !isEncrypted) {
        // Eagerly fallback to ask for passphrase
        isEncrypted = true;
        importMsg = { ok: false, text: 'El archivo está cifrado. Escribe la clave.' };
      } else {
        importMsg = { ok: false, text: errorText(err) };
      }
      snapshot = null;
    } finally {
      importing = false;
    }
  }

  function inventoryExportFilename(plain: boolean) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    return `fize-inventario-${ymd}.${plain ? 'json' : 'fize'}`;
  }

  function downloadFile(content: BlobPart, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function doExport() {
    if (!validExport) return;
    exporting = true;
    exportMsg = null;

    try {
      const currentInstanceId = 'local-instance'; // It uses the real instance id via getIdbAdapter inside buildInventorySnapshot? Actually, we must use buildInventorySnapshot from F4-1, which does exactly this. Wait, the problem says "asks for a passphrase ... calls buildInventorySnapshot".

      const rawSnap = await buildInventorySnapshot();
      if (exportPlain) {
        const text = JSON.stringify(rawSnap, null, 2);
        downloadFile(text, inventoryExportFilename(true), 'application/json');
      } else {
        const encSnap = await sealInventorySnapshot(rawSnap, exportPassphrase1);
        const text = JSON.stringify(encSnap);
        downloadFile(text, inventoryExportFilename(false), 'application/octet-stream');
      }

      exportMsg = { ok: true, text: 'Inventario exportado correctamente.' };
      exportPassphrase1 = '';
      exportPassphrase2 = '';
      exportPlain = false;
    } catch (err) {
      exportMsg = { ok: false, text: (err as Error).message || 'Error al exportar.' };
    } finally {
      exporting = false;
    }
  }

  function formatLocation(locId: string | undefined | null) {
    if (!snapshot || !locId) return '—';
    const loc = snapshot.locations.find(l => l.id === locId);
    return loc ? loc.name : locId;
  }
</script>

<div class="l-page bodega">
  <h1 class="l-title">Bodega</h1>
  <p class="l-lead">Solo lectura: esto no cambia tu inventario de Fize.</p>

  <section class="l-card" aria-labelledby="imp-title">
    <h2 id="imp-title">Ver inventario de otro equipo</h2>
    <p>Abre un archivo de inventario exportado desde Fize, Shelf o GARA-G.</p>
    <form class="form" onsubmit={loadFile}>
      <div class="l-field">
        <label for="bodega-file">Archivo de inventario</label>
        <input id="bodega-file" bind:this={fileInput} class="l-input" type="file" accept=".json,.fize,application/json,application/octet-stream" onchange={onFile} />
      </div>
      {#if isEncrypted}
        <div class="l-field">
          <label for="bodega-pass">Clave del archivo</label>
          <input
            id="bodega-pass"
            class="l-input"
            type="password"
            autocomplete="off"
            bind:value={importPassphrase}
          />
        </div>
      {/if}
      <button type="submit" class="l-btn" disabled={importing || !file}>
        {importing ? 'Abriendo archivo…' : 'Abrir inventario'}
      </button>
    </form>

    {#if importMsg}
      <p class={importMsg.ok ? 'l-alert l-alert-ok' : 'l-alert l-alert-error'} role={importMsg.ok ? 'status' : 'alert'} data-testid="import-msg">{importMsg.text}</p>
    {/if}
  </section>

  {#if snapshot}
    <section class="l-card snapshot" aria-labelledby="snap-title">
      <h2 id="snap-title">Inventario abierto</h2>

      <div class="badge-row">
        <span class="l-badge">App: {snapshot.source.appId}</span>
        <span class="l-badge">Instancia: {snapshot.source.instanceId.slice(0,8)}...</span>
        <span class="l-badge">Fecha: {new Date(snapshot.source.exportedAt).toLocaleDateString('es-CO')} ({age} días)</span>
      </div>

      <div class="l-field">
        <label for="filter-query">Buscar artículo</label>
        <input id="filter-query" type="text" class="l-input" bind:value={filterQuery} placeholder="Nombre o código SKU" />
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Artículo</th>
              <th>SKU</th>
              <th class="num">Cantidad</th>
              <th>Ubicación</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredRows as row}
              <tr class={isLowStock(row) ? 'low-stock' : ''}>
                <td>
                  <strong>{row.name}</strong>
                  {#if isLowStock(row)}
                    <span class="l-badge alert-badge">Stock bajo</span>
                  {/if}
                </td>
                <td class="l-mono">{row.sku || '—'}</td>
                <td class="num">{row.quantity} {row.unit || ''}</td>
                <td>{formatLocation(row.locationId)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="4">No se encontraron artículos.</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section class="l-card" aria-labelledby="exp-title">
    <h2 id="exp-title">Exportar mi inventario</h2>
    <p>Guarda una copia de tu inventario para verla en otro equipo o en GARA-G/Shelf.</p>

    <form class="form" onsubmit={(e) => { e.preventDefault(); doExport(); }}>
      <div class="l-field row-check">
        <input id="exp-plain" type="checkbox" bind:checked={exportPlain} />
        <label for="exp-plain">Sin cifrar (el archivo se podrá leer sin clave)</label>
      </div>

      {#if exportPlain}
        <p class="l-alert l-alert-warn" role="alert">
          Atención: El archivo sin cifrar puede ser abierto por cualquier persona que lo tenga.
        </p>
      {:else}
        <div class="l-field">
          <label for="exp-pass1">Clave de protección</label>
          <input
            id="exp-pass1"
            class="l-input"
            type="password"
            autocomplete="new-password"
            bind:value={exportPassphrase1}
            placeholder="Mínimo 8 caracteres"
          />
        </div>
        <div class="l-field">
          <label for="exp-pass2">Repite la clave</label>
          <input
            id="exp-pass2"
            class="l-input"
            type="password"
            autocomplete="new-password"
            bind:value={exportPassphrase2}
          />
        </div>
      {/if}

      <button type="submit" class="l-btn l-btn-primary" disabled={exporting || !validExport}>
        {exporting ? 'Exportando…' : 'Descargar inventario'}
      </button>
    </form>

    {#if exportMsg}
      <p class={exportMsg.ok ? 'l-alert l-alert-ok' : 'l-alert l-alert-error'} role={exportMsg.ok ? 'status' : 'alert'}>{exportMsg.text}</p>
    {/if}
  </section>
</div>

<style>
  .bodega { display: flex; flex-direction: column; gap: 1rem; }
  .form { display: flex; flex-direction: column; gap: 0.75rem; align-items: flex-start; }
  .form .l-field { width: 100%; }
  .row-check { flex-direction: row; align-items: center; gap: 0.5rem; }
  .l-card > .l-btn, .form > .l-btn { align-self: flex-start; margin-top: 0.25rem; }

  .snapshot { gap: 1rem; }
  .badge-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }

  .table-wrap { overflow-x: auto; width: 100%; border: 1px solid var(--swal-border); border-radius: var(--swal-radius); }
  .data-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem; }
  .data-table th, .data-table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--swal-border); }
  .data-table th { background: var(--swal-bg-elevated, var(--swal-bg)); font-weight: 600; color: var(--swal-text-secondary); white-space: nowrap; }
  .data-table .num { text-align: right; }

  .low-stock td { background: var(--swal-danger-muted, rgba(220, 38, 38, 0.1)); }
  .alert-badge { background: var(--swal-danger); color: white; border: none; margin-left: 0.5rem; font-size: 0.65rem; }
</style>
