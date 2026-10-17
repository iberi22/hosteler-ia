<script lang="ts">
  import { onMount } from 'svelte';
  import { getLockState, subscribeLockEvents, unlock } from '../../lib/local/deviceLock';

  let state = $state<'loading' | 'off' | 'locked' | 'unlocked'>('loading');
  let method = $state<'pin' | 'recovery'>('pin');
  let secret = $state('');
  let unlocking = $state(false);
  let errorMsg = $state<string | null>(null);

  onMount(() => {
    let alive = true;
    void getLockState()
      .then((lockState) => {
        if (alive) state = lockState;
      })
      .catch(() => {
        if (alive) state = 'off';
      });

    // "Bloquear ahora" en CUALQUIER pestaña: deviceLock ya tira la DEK de esta al recibir el aviso, y
    // aqui se cambia a 'locked', lo que saca del DOM todo el contenido del slot (los datos que el usuario
    // tenia a la vista) y deja solo la pantalla de desbloqueo.
    const unsubscribe = subscribeLockEvents(() => {
      void getLockState()
        .then((lockState) => {
          if (!alive || lockState !== 'locked') return;
          state = 'locked';
          secret = '';
          errorMsg = null;
        })
        .catch(() => undefined);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
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
{:else}
  <!--
    El contenido del layout se renderiza MIENTRAS se sabe si el equipo esta bloqueado ('loading') y
    cuando ya se sabe que no lo esta. Lo que se ve en ese instante es el marcado prerenderizado de las
    paginas de /local (menu, formularios vacios): los datos de negocio los traen las islas desde
    IndexedDB, y con la proteccion activa no hay DEK, asi que no cargan nada. Al pasar a 'locked' (o al
    recibir el aviso de otra pestaña) el bloque se destruye: los datos que hubiera a la vista salen del
    DOM, no solo se tapan con una capa.
  -->
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
