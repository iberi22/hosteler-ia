<script lang="ts">
  // LocalHome.svelte — /local/: onboarding la primera vez; despues, el inicio del local.
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/api-client';
  import { loadIdentity, requestPersistence, type PersistResult } from '../../lib/local/identity';
  import { getSettings, type LocalSettings } from '../../lib/local/localDb';
  import { loadOnboarding, type OnboardingState } from '../../lib/local/onboarding';
  import Onboarding from './Onboarding.svelte';
  import CloudLevels from './CloudLevels.svelte';

  let ob = $state<OnboardingState | null>(null);
  let restaurantName = $state('');
  let dishes = $state(0);
  let settings = $state<LocalSettings>({});
  let persist = $state<PersistResult | null>(null);
  let failed = $state<string | null>(null);

  const STALE_MS = 7 * 24 * 60 * 60 * 1000;
  const backupStale = $derived(!settings.lastBackupAt || Date.now() - Date.parse(settings.lastBackupAt) > STALE_MS);

  function setOnboardingFlag(on: boolean) {
    if (on) document.documentElement.dataset.onboarding = '1';
    else delete document.documentElement.dataset.onboarding;
  }

  async function loadHome() {
    await loadIdentity();
    const [rRes, mRes] = await Promise.all([apiFetch('/api/restaurants'), apiFetch('/api/menu-items')]);
    if (rRes.ok) restaurantName = String(((await rRes.json()) as Array<Record<string, unknown>>)[0]?.name ?? '');
    if (mRes.ok) dishes = ((await mRes.json()) as unknown[]).length;
    settings = await getSettings();
    persist = await requestPersistence();
  }

  onMount(async () => {
    try {
      const loaded = await loadOnboarding();
      ob = loaded;
      setOnboardingFlag(!loaded.completed);
      if (loaded.completed) await loadHome();
    } catch (err) {
      failed = (err as Error).message || 'No se pudo abrir Fize en este navegador.';
    }
  });

  async function done() {
    if (ob) ob = { ...ob, completed: true };
    setOnboardingFlag(false);
    await loadHome();
    window.scrollTo({ top: 0 });
  }

  function fmt(iso?: string) {
    return iso ? new Date(iso).toLocaleDateString('es-CO', { dateStyle: 'medium' }) : '';
  }
</script>

{#if failed}
  <div class="l-page">
    <p class="l-alert l-alert-error" role="alert">
      {failed} Si estás en una ventana privada o de incógnito, ábrelo en una ventana normal: ahí el navegador no guarda nada.
    </p>
  </div>
{:else if !ob}
  <div class="l-page"><p class="l-help">Abriendo Fize…</p></div>
{:else if !ob.completed}
  <Onboarding initial={ob} onDone={done} />
{:else}
  <div class="l-page">
    <h1 class="l-title">{restaurantName ? `Hola, ${restaurantName}` : 'Tu local'}</h1>
    <p class="l-lead">Todo lo que ves aquí está guardado en este equipo.</p>

    {#if backupStale}
      <p class="l-alert l-alert-warn" role="status">
        {settings.lastBackupAt ? `Tu última copia es del ${fmt(settings.lastBackupAt)}.` : 'Aún no tienes una copia descargada.'}
        <a href="/local/respaldo/">Haz una copia ahora</a>: si pierdes este equipo sin copia, se pierde todo.
      </p>
    {/if}

    <a class="l-card tile story-cta" href="/local/historias/">
      <h2>Crear historia para WhatsApp</h2>
      <p>Tu menú del día, un plato destacado o el QR de tu carta, listos para tu estado en dos toques.</p>
    </a>

    <div class="grid">
      <a class="l-card tile" href="/local/carta/">
        <h2>Carta</h2>
        <p>{dishes} {dishes === 1 ? 'plato' : 'platos'}. Edita precios, categorías y disponibilidad.</p>
      </a>
      <a class="l-card tile" href="/local/mesas/">
        <h2>Mesas</h2>
        <p>Gestión de mesas y códigos QR de pedido.</p>
      </a>
      <a class="l-card tile" href="/local/pedidos/">
        <h2>Pedidos</h2>
        <p>Listado de pedidos en tiempo real.</p>
      </a>
      <a class="l-card tile" href="/local/cocina/">
        <h2>Cocina</h2>
        <p>Kitchen Display System.</p>
      </a>
      <a class="l-card tile" href="/local/publicar/">
        <h2>Publicar y QR</h2>
        <p>{settings.lastPublishedAt ? `Publicada el ${fmt(settings.lastPublishedAt)}.` : 'Aún sin publicar.'} Imprime el QR de tus mesas.</p>
      </a>
      <a class="l-card tile" href="/local/respaldo/">
        <h2>Copia de seguridad</h2>
        <p>{settings.lastBackupAt ? `Última copia: ${fmt(settings.lastBackupAt)}.` : 'Sin copias todavía.'}</p>
      </a>
      <a class="l-card tile" href="/local/ajustes/">
        <h2>Mi local</h2>
        <p>Nombre, WhatsApp, dirección y enlace de tu carta.</p>
      </a>
    </div>

    <p class="l-help" data-testid="persist">
      {persist === 'granted'
        ? 'Almacenamiento protegido: el navegador no borrará estos datos para liberar espacio.'
        : 'El navegador podría borrar estos datos si le falta espacio: instala Fize y haz copias seguido.'}
    </p>

    <h2 class="sub">Después, si quieres</h2>
    <CloudLevels />
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.75rem; }
  .tile { text-decoration: none; transition: background 150ms; }
  .tile:hover { background: var(--swal-surface-hover); }
  .story-cta { border-color: var(--swal-border-strong, var(--swal-border)); }
  .sub { font-size: 1.0625rem; font-weight: 650; color: var(--swal-text); margin-top: 0.5rem; }
</style>
