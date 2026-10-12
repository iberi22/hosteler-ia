<script lang="ts">
  // PairModal.svelte — emparejamiento LAN por QR/código (P5).
  // Tab host: genera invitación (QR escaneable + código manual + expiración).
  // Tab join: escanea con cámara (fallback manual) y une al room con clave.
  import { onMount } from 'svelte';
  import RealQr from '../RealQr.svelte';
  import PairScanner from './PairScanner.svelte';
  import ManualJoin from './ManualJoin.svelte';
  import {
    pairing,
    pairingInit,
    issuePairing,
    joinWithQr,
    joinWithCode,
    leavePairing,
    confirmGuestJoined,
    pendingKeys,
  } from '../../stores/pairing.svelte';

  let tab: 'host' | 'join' = $state('host');
  let relayUrl = $state('ws://192.168.1.50:4444');
  let deviceName = $state('');
  let keys = $state<Array<{ key: string; name: string; expiresAt: number }>>([]);
  let now = $state(Date.now());
  let manualMode = $state(false);

  onMount(() => {
    pairingInit();
    document.querySelector('[data-testid="pair-root"]')?.setAttribute('data-hydrated', '1');
    const t = setInterval(() => { now = Date.now(); keys = pendingKeys(); }, 1000);
    return () => clearInterval(t);
  });

  function secsLeft(exp: number) {
    return Math.max(0, Math.round((exp - now) / 1000));
  }
</script>

<div class="pair" data-testid="pair-root">
  <h2>Emparejar tablets (LAN, sin internet)</h2>

  {#if pairing.status === 'paired'}
    <div class="pair-ok" data-testid="pair-paired">
      <p>Unido al room <code>{pairing.pairedRoom}</code></p>
      <p class="muted">Relay: {pairing.relay}</p>
      <button class="btn danger" onclick={() => leavePairing()}>Salir del emparejamiento</button>
    </div>
  {:else}
    <div class="tabs" role="tablist">
      <button role="tab" class:active={tab === 'host'} onclick={() => (tab = 'host')}>Mostrar mi QR</button>
      <button role="tab" class:active={tab === 'join'} onclick={() => (tab = 'join')}>Unir a un nodo</button>
    </div>

    {#if tab === 'host'}
      <div class="pane" data-testid="pair-host">
        <label>Relay local (IP de esta tablet + puerto)
          <input bind:value={relayUrl} placeholder="ws://192.168.1.50:4444" data-testid="pair-relay" />
        </label>
        <label>Nombre de este nodo
          <input bind:value={deviceName} placeholder="Caja-1" data-testid="pair-name" />
        </label>
        <button class="btn" onclick={() => { issuePairing(relayUrl, deviceName || 'nodo'); keys = pendingKeys(); }} data-testid="pair-issue">
          Generar invitación
        </button>
        {#if pairing.current}
          <div class="invite" data-testid="pair-invite">
            <RealQr value={pairing.current.qrText} size={220} title="QR de emparejamiento" />
            {#if pairing.current.manualCode}
              <p>Código manual: <code data-testid="pair-code">{pairing.current.manualCode}</code></p>
            {:else}
              <p class="muted">Relay con hostname: solo QR (el código manual exige IPv4).</p>
            {/if}
            <p class="muted">Expira en {secsLeft(pairing.current.expiresAt)}s · un solo uso</p>
          </div>
        {/if}
        {#if keys.length > 0}
          <div class="keys">
            <h3>Invitaciones pendientes</h3>
            {#each keys as k}
              <div class="keyrow">
                <span>{k.name} · {secsLeft(k.expiresAt)}s</span>
                <button class="btn small" onclick={() => { confirmGuestJoined(k.key); keys = pendingKeys(); }}>Confirmar entrada</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="pane" data-testid="pair-join">
        {#if !manualMode}
          <PairScanner onScanned={(t) => joinWithQr(t)} onManualJoin={(c) => joinWithCode(c)} />
          <button class="btn ghost" onclick={() => (manualMode = true)} data-testid="pair-use-code">
            Tengo un código / sin cámara
          </button>
        {:else}
          {#key manualMode}
            <ManualJoin onJoin={(c) => joinWithCode(c)} />
          {/key}
        {/if}
        {#if pairing.status === 'joining'}<p class="muted">Uniendo…</p>{/if}
      </div>
    {/if}

    {#if pairing.status === 'error' && pairing.error}
      <p class="err" role="alert" data-testid="pair-error">{pairing.error}</p>
    {/if}
  {/if}
</div>

<style>
  .pair { display: grid; gap: 1rem; max-width: 560px; }
  .muted { color: var(--swal-text-muted); font-size: 0.85rem; }
  .tabs { display: flex; gap: 0.5rem; }
  .tabs button { flex: 1; padding: 0.6rem; border-radius: 8px; border: 1px solid var(--swal-border); background: var(--swal-surface); color: var(--swal-text); cursor: pointer; }
  .tabs button.active { border-color: var(--swal-accent); }
  .pane { display: grid; gap: 0.75rem; }
  .pane label { display: grid; gap: 0.25rem; font-size: 0.85rem; }
  .pane input { background: var(--swal-surface); border: 1px solid var(--swal-border); border-radius: 8px; padding: 0.6rem; color: var(--swal-text); }
  .btn { background: var(--swal-accent); color: white; border: 0; border-radius: 8px; padding: 0.6rem 1rem; font-weight: 600; cursor: pointer; }
  .btn.small { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
  .btn.ghost { background: transparent; border: 1px solid var(--swal-border); color: var(--swal-text); }
  .btn.danger { background: var(--swal-danger); }
  .invite { display: grid; gap: 0.5rem; justify-items: center; }
  .invite code { font-size: 1rem; letter-spacing: 0.05em; }
  .keys { display: grid; gap: 0.5rem; }
  .keyrow { display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--swal-border); border-radius: 8px; padding: 0.5rem; }
  .err { color: #f87171; }
  .pair-ok code { word-break: break-all; font-size: 0.8rem; }
</style>
