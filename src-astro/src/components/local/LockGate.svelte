<script lang="ts">
  import { onMount } from 'svelte';
  import { getLockState, unlock } from '../../lib/local/deviceLock';

  let state = $state<'loading' | 'off' | 'locked' | 'unlocked'>('loading');
  let method = $state<'pin' | 'recovery'>('pin');
  let secret = $state('');
  let unlocking = $state(false);
  let errorMsg = $state<string | null>(null);

  onMount(async () => {
    try {
      const lockState = await getLockState();
      state = lockState;
    } catch {
      state = 'off';
    }
  });

  async function submitUnlock(e: Event) {
    e.preventDefault();
    if (!secret.trim()) return;

    unlocking = true;
    errorMsg = null;
    try {
      await unlock(method, secret);
      state = 'unlocked';
      secret = '';
    } catch (err) {
      errorMsg = (err as Error).message || 'Clave incorrecta';
    } finally {
      unlocking = false;
    }
  }
</script>

{#if state === 'locked'}
  <div class="lock-gate">
    <div class="lock-card l-card">
      <h1 class="l-title">Fize bloqueado</h1>
      <p class="l-lead">Introduce tu PIN o código de recuperación para abrir tu local.</p>

      <form class="form" onsubmit={submitUnlock}>
        <div class="tabs l-row">
          <button type="button" class="l-btn {method === 'pin' ? 'active' : ''}" onclick={() => { method = 'pin'; errorMsg = null; }}>PIN</button>
          <button type="button" class="l-btn {method === 'recovery' ? 'active' : ''}" onclick={() => { method = 'recovery'; errorMsg = null; }}>Código de recuperación</button>
        </div>

        <div class="l-field">
          <label for="lock-secret">{method === 'pin' ? 'PIN' : 'Código de recuperación'}</label>
          <input
            id="lock-secret"
            class="l-input {method === 'recovery' ? 'l-mono' : ''}"
            type={method === 'pin' ? 'password' : 'text'}
            autocomplete="off"
            spellcheck="false"
            bind:value={secret}
            placeholder={method === 'recovery' ? 'XXXX-XXXX-XXXX-XXXX' : 'Tu PIN'}
          />
        </div>

        <button type="submit" class="l-btn l-btn-primary" disabled={unlocking || !secret.trim()}>
          {unlocking ? 'Desbloqueando…' : 'Desbloquear'}
        </button>
      </form>

      {#if errorMsg}
        <p class="l-alert l-alert-error" role="alert">{errorMsg}</p>
      {/if}
      <p class="l-help">Si olvidaste tu PIN y no tienes tu código de recuperación ni una copia descargada, tus datos se perderán.</p>
    </div>
  </div>
{:else if state === 'off' || state === 'unlocked'}
  <slot />
{/if}

<style>
  .lock-gate {
    position: fixed;
    inset: 0;
    background: var(--swal-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 9999;
  }
  .lock-card {
    max-width: 24rem;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .tabs .l-btn {
    flex: 1;
    background: transparent;
    border-color: transparent;
    color: var(--swal-text-secondary);
  }
  .tabs .l-btn.active {
    background: var(--swal-surface-active, var(--swal-surface));
    color: var(--swal-text);
    border-color: var(--swal-border);
  }
</style>
