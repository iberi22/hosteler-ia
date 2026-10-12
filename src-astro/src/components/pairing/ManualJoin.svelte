<script lang="ts">
  // ManualJoin.svelte — fallback sin cámara (iPads viejos, sin BarcodeDetector).
  // Código formato FZ1-XXXX-XXXX-XXXX-XXXXXXXX. Emite join(code) validado abajo por P6.
  let { onJoin = (_code: string) => {}, disabled = false } = $props<{
    onJoin?: (code: string) => void; disabled?: boolean;
  }>();

  let code = $state('');
  let err = $state('');

  function submit() {
    err = '';
    const clean = code.trim();
    if (clean.length < 10) {
      err = 'Código muy corto, revisa los grupos.';
      return;
    }
    onJoin(clean);
  }
</script>

<div class="manual">
  <label class="manual-label" for="pair-code">Código de emparejamiento</label>
  <div class="manual-row">
    <input
      id="pair-code"
      class="manual-input"
      placeholder="FZ1-XXXX-XXXX-XXXX-XXXXXXXX"
      bind:value={code}
      autocomplete="off"
      spellcheck="false"
      {disabled}
    />
    <button class="manual-btn" onclick={submit} {disabled}>Unir</button>
  </div>
  {#if err}<p class="manual-err" role="alert">{err}</p>{/if}
</div>

<style>
  .manual { display: grid; gap: 0.5rem; }
  .manual-label { font-size: 0.8rem; color: var(--swal-text-muted); }
  .manual-row { display: flex; gap: 0.5rem; }
  .manual-input { flex: 1; font-family: var(--swal-font-mono); text-transform: uppercase; background: var(--swal-surface); border: 1px solid var(--swal-border); border-radius: 8px; padding: 0.6rem; color: var(--swal-text); }
  .manual-btn { background: var(--swal-accent); color: white; border: 0; border-radius: 8px; padding: 0.6rem 1rem; font-weight: 600; cursor: pointer; }
  .manual-err { color: #f87171; font-size: 0.8rem; margin: 0; }
</style>
