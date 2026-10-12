<script lang="ts">
  // InstallPrompt.svelte — patrón deferredPrompt de beforeinstallprompt
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let installed = $state(false);
  let dismissed = $state(false);

  $effect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
    };
    const onInstalled = () => {
      installed = true;
      deferredPrompt = null;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installed = true;
    } else {
      dismissed = true;
    }
    deferredPrompt = null;
  }
</script>

{#if deferredPrompt && !installed && !dismissed}
  <div class="install-prompt" role="dialog" aria-label="Instalar aplicación">
    <span>Instala Fi’ze para acceso rápido sin conexión</span>
    <button onclick={install}>Instalar</button>
    <button onclick={() => (dismissed = true)} aria-label="Ahora no">✕</button>
  </div>
{/if}

<style>
  .install-prompt {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    padding: 0.6rem 1rem;
    font-size: 0.9rem;
    background: var(--swal-surface, #0f0f10);
    border-bottom: 1px solid var(--swal-border, #1e293b);
  }

  /*
   * WCAG 2.2 2.5.8 (Target Size, AA): todo control necesita >= 24x24 CSS px.
   * El boton de cerrar daba 15x19 y el de instalar 19px de alto: con el
   * borde transparente de 2px el area pulsable llega a 24 sin engordar lo
   * que se ve (el classic "padding transparente" en vez de mas margen).
   */
  button {
    cursor: pointer;
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0.4rem 0.8rem;
    border: 2px solid transparent;
    border-radius: 0.5rem;
    /* Boton primario del tema: acento monocromatico (marfil en oscuro, grafito en
     claro). Antes era `--swal-accent-cyan`, un token que Bone ya no define, asi
     que caia al fallback #22d3ee y se veia turquesa sobre el grafito — el unico
     color saturado que quedaba en la app. Con --swal-accent el boton hereda el
     contraste del tema en vez de pelearse con el. */
    background: var(--swal-accent, #f5f5f4);
    color: var(--swal-accent-contrast, #1c1917);
    font: inherit;
    font-weight: 600;
  }
  button[aria-label='Ahora no'] {
    background: transparent;
    color: var(--swal-text-secondary, #a8a29e);
    padding: 0.4rem;
  }

  /* WCAG 2.4.7 Focus Visible: el foco solo se dibuja para navegacion por teclado.
     Antes era `--swal-accent-orange`: otro token que ya no existe, con fallback
     #f97316. Un anillo de foco naranja sobre papel es exactamente el tipo de
     excepcion cromatica que el tema Bone elimina. */
  button:focus-visible {
    outline: 2px solid var(--swal-accent, #1c1917);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    button { transition: none; }
  }
</style>
