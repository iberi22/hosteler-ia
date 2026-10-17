<script lang="ts">
  import { onMount } from 'svelte';
  import { getLockState, enableProtection, disableProtection, changePin, lock } from '../../lib/local/deviceLock';

  let state = $state<'loading' | 'off' | 'locked' | 'unlocked'>('loading');
  let modifying = $state(false);
  let newPin = $state('');
  let verifyPin = $state('');
  let oldPin = $state('');
  let action = $state<'none' | 'enable' | 'disable' | 'change'>('none');
  let msg = $state<{ ok: boolean; text: string } | null>(null);
  let newCode = $state<string | null>(null);

  onMount(async () => {
    state = await getLockState();
  });

  async function handleEnable(e: Event) {
    e.preventDefault();
    if (newPin !== verifyPin || newPin.length < 6) {
      msg = { ok: false, text: 'El PIN debe coincidir y tener al menos 6 caracteres.' };
      return;
    }
    modifying = true;
    msg = null;
    try {
      newCode = await enableProtection('pin', newPin);
      state = 'unlocked';
      action = 'none';
      newPin = '';
      verifyPin = '';
      msg = { ok: true, text: 'Protección activada. Guarda bien tu código de recuperación.' };
    } catch (err) {
      msg = { ok: false, text: (err as Error).message };
    } finally {
      modifying = false;
    }
  }

  async function handleDisable(e: Event) {
    e.preventDefault();
    modifying = true;
    msg = null;
    try {
      await disableProtection();
      state = 'off';
      action = 'none';
      msg = { ok: true, text: 'Protección desactivada. Tus datos locales ya no están cifrados.' };
    } catch (err) {
      msg = { ok: false, text: (err as Error).message };
    } finally {
      modifying = false;
    }
  }

  async function handleChange(e: Event) {
    e.preventDefault();
    if (newPin !== verifyPin || newPin.length < 6) {
      msg = { ok: false, text: 'El nuevo PIN debe coincidir y tener al menos 6 caracteres.' };
      return;
    }
    modifying = true;
    msg = null;
    try {
      await changePin(oldPin, newPin);
      action = 'none';
      oldPin = '';
      newPin = '';
      verifyPin = '';
      msg = { ok: true, text: 'PIN cambiado con éxito.' };
    } catch (err) {
      msg = { ok: false, text: (err as Error).message };
    } finally {
      modifying = false;
    }
  }

  function doLock() {
    lock();
    window.location.reload();
  }
</script>

<section class="l-card protection-card" aria-labelledby="prot-title">
  <h2 id="prot-title">Bloqueo y Cifrado</h2>
  <p>
    Protege tus ventas y correos con un PIN. Cuando lo activas, los datos se cifran para que no puedan ser
    leídos copiando el perfil del navegador. Ojo: no protege contra malware si el equipo está infectado.
  </p>

  {#if state === 'loading'}
    <p>Cargando…</p>
  {:else if state === 'off'}
    <p class="l-alert l-alert-warn">La protección está desactivada. Cualquiera con acceso al navegador puede ver tus datos.</p>
    {#if action === 'enable'}
      <form class="form" onsubmit={handleEnable}>
        <div class="l-field">
          <label for="new-pin">Crea un PIN (mín. 6 dígitos)</label>
          <input id="new-pin" class="l-input" type="password" bind:value={newPin} minlength="6" required />
        </div>
        <div class="l-field">
          <label for="verify-pin">Verifica el PIN</label>
          <input id="verify-pin" class="l-input" type="password" bind:value={verifyPin} minlength="6" required />
        </div>
        <p class="l-help">Atención: Si pierdes el PIN y no tienes una copia de seguridad o tu código de recuperación, vas a perder tus datos irremediablemente.</p>
        <div class="l-row">
          <button type="submit" class="l-btn l-btn-primary" disabled={modifying}>Activar</button>
          <button type="button" class="l-btn" onclick={() => { action = 'none'; msg = null; }}>Cancelar</button>
        </div>
      </form>
    {:else}
      <button class="l-btn l-btn-primary" onclick={() => { action = 'enable'; msg = null; }}>Activar protección con PIN</button>
    {/if}
  {:else}
    <p class="l-alert l-alert-ok">Protección activada. Tu local está cifrado.</p>

    {#if newCode}
      <div class="l-alert l-alert-warn">
        <p><strong>Tu código de recuperación:</strong> <span class="l-mono">{newCode}</span></p>
        <p>Anótalo en un papel y guárdalo. Se muestra una sola vez. Sin este código y sin el PIN, vas a perder todos los datos de este equipo.</p>
        <button class="l-btn" type="button" onclick={() => newCode = null}>Ya lo guardé</button>
      </div>
    {/if}

    <div class="l-row">
      <button class="l-btn" type="button" onclick={doLock}>Bloquear ahora</button>
      <button class="l-btn" type="button" onclick={() => { action = 'change'; msg = null; }}>Cambiar PIN</button>
      <button class="l-btn" type="button" onclick={() => { action = 'disable'; msg = null; }}>Desactivar</button>
    </div>

    {#if action === 'change'}
      <form class="form" onsubmit={handleChange}>
        <div class="l-field">
          <label for="old-pin">PIN actual</label>
          <input id="old-pin" class="l-input" type="password" bind:value={oldPin} required />
        </div>
        <div class="l-field">
          <label for="new-pin-c">Nuevo PIN</label>
          <input id="new-pin-c" class="l-input" type="password" bind:value={newPin} minlength="6" required />
        </div>
        <div class="l-field">
          <label for="verify-pin-c">Verifica el nuevo PIN</label>
          <input id="verify-pin-c" class="l-input" type="password" bind:value={verifyPin} minlength="6" required />
        </div>
        <div class="l-row">
          <button type="submit" class="l-btn l-btn-primary" disabled={modifying}>Guardar PIN</button>
          <button type="button" class="l-btn" onclick={() => { action = 'none'; msg = null; }}>Cancelar</button>
        </div>
      </form>
    {:else if action === 'disable'}
      <form class="form" onsubmit={handleDisable}>
        <p class="l-alert l-alert-warn">Desactivar el cifrado guardará tus datos de vuelta en texto plano.</p>
        <div class="l-row">
          <button type="submit" class="l-btn l-btn-primary" disabled={modifying}>Sí, desactivar</button>
          <button type="button" class="l-btn" onclick={() => { action = 'none'; msg = null; }}>Cancelar</button>
        </div>
      </form>
    {/if}
  {/if}

  {#if msg}
    <p class={msg.ok ? 'l-alert l-alert-ok' : 'l-alert l-alert-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>
  {/if}
</section>

<style>
  .protection-card {
    margin-top: 1rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--swal-border);
  }
</style>
