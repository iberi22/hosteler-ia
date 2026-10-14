<script lang="ts">
  // BackupCard.svelte — copia cifrada en archivo (nivel N1, NODO-LOCAL.md §2.3 y §3).
  // Exportar: archivo `.fize` cifrado en este equipo con el codigo de recuperacion.
  // Importar: archivo + codigo. Se descifra y valida TODO antes de escribir: codigo errado o archivo
  // alterado = mensaje claro y el equipo queda como estaba. Si la copia es de OTRO local, se muestra un
  // aviso con los dos locales y hay que escribir REEMPLAZAR; antes de cambiar se descarga una copia cifrada
  // del local actual (con su codigo) y sus datos quedan archivados en el equipo.
  import { onMount, tick } from 'svelte';
  import { BackupError, formatRecoveryCode } from '../../lib/local/backupCrypto';
  import {
    BACKUP_EXTENSION,
    describeBackupLocal,
    describeCurrentLocal,
    downloadSafetyBackup,
    exportBackupFile,
    openBackup,
    restoreBackup,
    type LocalSummary,
  } from '../../lib/local/backupData';
  import { exportMyData } from '../../lib/local/exportPlain';
  import { loadIdentity } from '../../lib/local/identity';
  import { getLocal, getSettings } from '../../lib/local/localDb';
  import { publicMenuUrl } from '../../lib/local/localMode';

  const CONFIRM_WORD = 'REEMPLAZAR';

  let hasLocal = $state(false);
  let hasCode = $state(false);
  let lastBackupAt = $state<string | undefined>(undefined);
  let loaded = $state(false);

  let exporting = $state(false);
  let exportMsg = $state<{ ok: boolean; text: string } | null>(null);

  let file = $state<File | null>(null);
  let code = $state('');
  let importing = $state(false);
  let importMsg = $state<{ ok: boolean; text: string } | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  // Aviso de reemplazo (copia de otro local).
  interface ForeignRestore {
    text: string;
    code: string;
    current: LocalSummary;
    incoming: LocalSummary;
    hasCode: boolean;
  }
  let foreign = $state<ForeignRestore | null>(null);
  let typed = $state('');
  let replacing = $state(false);
  let warnBox = $state<HTMLElement | null>(null);
  const typedOk = $derived(typed.trim().toUpperCase() === CONFIRM_WORD);

  const STALE_MS = 7 * 24 * 60 * 60 * 1000;
  const stale = $derived(!lastBackupAt || Date.now() - Date.parse(lastBackupAt) > STALE_MS);

  async function refresh() {
    hasLocal = Boolean(await loadIdentity());
    hasCode = Boolean(await getLocal<string>('recoveryCode'));
    lastBackupAt = (await getSettings()).lastBackupAt;
  }

  onMount(async () => {
    try {
      await refresh();
    } finally {
      loaded = true;
    }
  });

  async function doExport() {
    exporting = true;
    exportMsg = null;
    try {
      const name = await exportBackupFile();
      exportMsg = { ok: true, text: `Copia descargada: ${name}. Guárdala fuera de este equipo (memoria USB, correo, nube).` };
      await refresh();
    } catch (e) {
      exportMsg = { ok: false, text: (e as Error).message || 'No se pudo crear la copia.' };
    } finally {
      exporting = false;
    }
  }

  function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
    importMsg = null;
  }

  async function finishRestore(summary: { counts: Record<string, number>; replacedOtherLocal: boolean }, safety: string | null) {
    const n = summary.counts.menuItem ?? 0;
    const base = `Copia restaurada en este equipo (${n} ${n === 1 ? 'plato' : 'platos'} y sus datos).`;
    const extra = summary.replacedOtherLocal
      ? safety
        ? ` Tu local anterior quedó guardado en este equipo y en el archivo ${safety}.`
        : ' Tu local anterior quedó guardado en este equipo.'
      : '';
    importMsg = { ok: true, text: `${base}${extra} Abriendo tu local…` };
    code = '';
    file = null;
    if (fileInput) fileInput.value = '';
    await refresh();
    setTimeout(() => location.assign('/local/'), summary.replacedOtherLocal ? 1800 : 900);
  }

  function errorText(err: unknown): string {
    return err instanceof BackupError ? err.message : (err as Error).message || 'No se pudo restaurar la copia.';
  }

  async function doImport(e: Event) {
    e.preventDefault();
    if (!file) {
      importMsg = { ok: false, text: 'Elige el archivo de la copia (.fize).' };
      return;
    }
    importing = true;
    importMsg = null;
    foreign = null;
    try {
      const text = await file.text();
      // Primero abrir (descifrar y validar) sin escribir nada; luego confirmar el reemplazo.
      const plain = await openBackup(text, code);
      const current = await loadIdentity();
      if (current && current.instanceId !== plain.local.identity.instanceId) {
        // Copia de OTRO local: aviso con los dos locales y confirmacion escrita.
        const now = await describeCurrentLocal();
        foreign = {
          text,
          code,
          current: now ?? { instanceId: current.instanceId, name: null, slug: null },
          incoming: describeBackupLocal(plain),
          hasCode: Boolean(await getLocal<string>('recoveryCode')),
        };
        typed = '';
        importing = false;
        await tick();
        warnBox?.focus();
        warnBox?.scrollIntoView({ block: 'start' });
        return;
      }
      const dishes = (plain.stores.menuItem ?? []).filter((r) => !(r as Record<string, unknown>).deleted_at).length;
      if (current && !globalThis.confirm?.(`Esta copia reemplaza los datos de este equipo por los de la copia (${dishes} platos). ¿Continuar?`)) {
        importing = false;
        return;
      }
      await finishRestore(await restoreBackup(text, code), null);
    } catch (err) {
      importMsg = { ok: false, text: errorText(err) };
    } finally {
      importing = false;
    }
  }

  function cancelForeign() {
    foreign = null;
    typed = '';
    importMsg = { ok: true, text: 'No se restauró la copia. Tu local sigue igual en este equipo.' };
  }

  async function confirmForeign(e: Event) {
    e.preventDefault();
    if (!foreign || !typedOk) return;
    replacing = true;
    importMsg = null;
    try {
      // Antes de cambiar: copia cifrada del local actual con SU codigo (si este equipo lo tiene).
      const safety = foreign.hasCode ? await downloadSafetyBackup() : null;
      const summary = await restoreBackup(foreign.text, foreign.code, { replaceInstance: true });
      foreign = null;
      typed = '';
      await finishRestore(summary, safety);
    } catch (err) {
      importMsg = { ok: false, text: errorText(err) };
    } finally {
      replacing = false;
    }
  }

  function localName(l: LocalSummary): string {
    return l.name ?? 'un local sin nombre';
  }

  function cartaLink(l: LocalSummary): string | null {
    return l.slug ? publicMenuUrl(l.slug).replace(/^https:\/\//, '') : null;
  }

  function fmt(iso?: string) {
    return iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }
</script>

<div class="backup">
  <section class="l-card" aria-labelledby="exp-title">
    <h2 id="exp-title">Descargar una copia</h2>
    <p>
      La copia guarda tu carta, los datos de tu local y la llave de este equipo. Se cifra aquí mismo con tu código de
      recuperación: sin ese código nadie puede abrir el archivo, tampoco SWAL.
    </p>
    {#if !loaded}
      <p>Cargando…</p>
    {:else if !hasLocal}
      <p>Todavía no hay un local en este equipo. Si ya tienes una copia, restáurala abajo.</p>
    {:else if !hasCode}
      <p class="l-alert l-alert-warn">Este equipo aún no tiene código de recuperación. Termina el paso 4 en <a href="/local/">Inicio</a>.</p>
    {:else}
      <p class={stale ? 'l-alert l-alert-warn' : 'l-help'} data-testid="last-backup">
        {lastBackupAt ? `Última copia: ${fmt(lastBackupAt)}.` : 'Aún no has descargado ninguna copia.'}
        {stale ? ' Haz una copia al menos una vez por semana.' : ''}
      </p>
      <button type="button" class="l-btn l-btn-primary" onclick={doExport} disabled={exporting}>
        {exporting ? 'Cifrando…' : `Descargar copia cifrada (${BACKUP_EXTENSION})`}
      </button>
    {/if}
    {#if exportMsg}
      <p class={exportMsg.ok ? 'l-alert l-alert-ok' : 'l-alert l-alert-error'} role={exportMsg.ok ? 'status' : 'alert'}>{exportMsg.text}</p>
    {/if}
  </section>

  {#if hasLocal}
    <section class="l-card" aria-labelledby="plain-export-title">
      <h2 id="plain-export-title">Exportar mis datos</h2>
      <p class="l-alert l-alert-warn">
        Estos archivos <strong>NO están cifrados</strong>. Contienen todos los datos de este equipo (correos del personal, ventas, etc.). Manéjalos con cuidado.
      </p>
      <div class="l-row l-stack-mobile">
        <button type="button" class="l-btn" onclick={() => exportMyData('json')} disabled={exporting}>Descargar JSON</button>
        <button type="button" class="l-btn" onclick={() => exportMyData('sql')} disabled={exporting}>Descargar SQL</button>
      </div>
    </section>
  {/if}

  <section class="l-card" aria-labelledby="imp-title">
    <h2 id="imp-title">Restaurar una copia</h2>
    <p>Para pasar Fize a un equipo nuevo o recuperar tus datos. <strong>Reemplaza</strong> lo que haya en este equipo por lo de la copia.</p>
    <form class="form" onsubmit={doImport}>
      <div class="l-field">
        <label for="backup-file">Archivo de la copia</label>
        <input id="backup-file" bind:this={fileInput} class="l-input" type="file" accept="{BACKUP_EXTENSION},application/json,application/octet-stream" onchange={onFile} />
      </div>
      <div class="l-field">
        <label for="backup-code">Código de recuperación</label>
        <input
          id="backup-code"
          class="l-input l-mono"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          bind:value={code}
          onblur={() => (code = code.trim() ? formatRecoveryCode(code) : '')}
        />
        <p class="l-help">Son 16 caracteres en 4 grupos. Da igual mayúsculas o minúsculas.</p>
      </div>
      <button type="submit" class="l-btn" disabled={importing || replacing || !file || !code.trim()}>
        {importing ? 'Abriendo la copia…' : 'Restaurar copia'}
      </button>
    </form>
    {#if foreign}
      <section
        class="l-alert l-alert-warn foreign"
        role="alertdialog"
        aria-modal="false"
        aria-labelledby="foreign-title"
        aria-describedby="foreign-desc"
        tabindex="-1"
        bind:this={warnBox}
        data-testid="foreign-warning"
      >
        <h3 id="foreign-title">Esta copia es de otro local</h3>
        <dl id="foreign-desc" class="locals">
          <div>
            <dt>En este equipo está</dt>
            <dd>
              <strong data-testid="foreign-current-name">{localName(foreign.current)}</strong>
              {#if cartaLink(foreign.current)}<span class="l-mono link" data-testid="foreign-current-link">{cartaLink(foreign.current)}</span>{/if}
            </dd>
          </div>
          <div>
            <dt>La copia es de</dt>
            <dd>
              <strong data-testid="foreign-incoming-name">{localName(foreign.incoming)}</strong>
              {#if cartaLink(foreign.incoming)}<span class="l-mono link" data-testid="foreign-incoming-link">{cartaLink(foreign.incoming)}</span>{/if}
            </dd>
          </div>
        </dl>
        <p>Si continúas:</p>
        <ul>
          <li>Este equipo pasa a trabajar con <strong>{localName(foreign.incoming)}</strong>: su carta, sus datos y su llave.</li>
          <li>
            <strong>{localName(foreign.current)}</strong> deja de estar activo aquí y desde este equipo ya no podrás actualizar su carta
            publicada{cartaLink(foreign.current) ? ` (${cartaLink(foreign.current)})` : ''}.
          </li>
          {#if foreign.hasCode}
            <li>Antes de cambiar se descarga una copia cifrada de <strong>{localName(foreign.current)}</strong> con tu código actual. Guárdala: con ella y ese código lo recuperas.</li>
          {:else}
            <li>Este equipo no tiene código de recuperación, así que no se puede descargar una copia de <strong>{localName(foreign.current)}</strong>.</li>
          {/if}
          <li>Los datos de <strong>{localName(foreign.current)}</strong> no se borran: quedan guardados en este equipo.</li>
        </ul>
        <form class="form" onsubmit={confirmForeign}>
          <div class="l-field">
            <label for="foreign-confirm">Para confirmar, escribe <strong>{CONFIRM_WORD}</strong></label>
            <input
              id="foreign-confirm"
              class="l-input l-mono"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              bind:value={typed}
            />
          </div>
          <div class="l-row l-stack-mobile">
            <button type="submit" class="l-btn l-btn-danger" disabled={!typedOk || replacing}>
              {replacing ? 'Reemplazando…' : `Reemplazar por ${localName(foreign.incoming)}`}
            </button>
            <button type="button" class="l-btn" onclick={cancelForeign} disabled={replacing}>Cancelar</button>
          </div>
        </form>
      </section>
    {/if}
    {#if importMsg}
      <p class={importMsg.ok ? 'l-alert l-alert-ok' : 'l-alert l-alert-error'} role={importMsg.ok ? 'status' : 'alert'} data-testid="import-msg">{importMsg.text}</p>
    {/if}
  </section>
</div>

<style>
  .backup { display: flex; flex-direction: column; gap: 1rem; }
  .form { display: flex; flex-direction: column; gap: 0.75rem; align-items: flex-start; }
  .form .l-field { width: 100%; }
  .l-card > .l-btn { align-self: flex-start; }
  .foreign { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
  .foreign:focus { outline: 2px solid var(--swal-warning); outline-offset: 2px; }
  .foreign h3 { margin: 0; font-size: 1.05rem; }
  .foreign p, .foreign ul { margin: 0; }
  .foreign ul { padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.35rem; }
  .locals { margin: 0; display: grid; gap: 0.5rem; }
  .locals div { display: flex; flex-direction: column; gap: 0.1rem; }
  .locals dt { font-size: 0.85rem; }
  .locals dd { margin: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
  .link { font-size: 0.85rem; }
  /* Texto del tema sobre fondo tenue: contraste AA en claro y en oscuro (el rojo puro con blanco no pasa en oscuro). */
  .l-btn-danger { background: var(--swal-danger-muted); border: 2px solid var(--swal-danger); color: var(--swal-text); font-weight: 600; }
</style>
