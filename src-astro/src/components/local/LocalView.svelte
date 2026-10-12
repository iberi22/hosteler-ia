<script lang="ts">
  // LocalView.svelte — pantallas /local/{carta,ajustes,respaldo,publicar}.
  // Sin local creado en este equipo solo se puede restaurar una copia; el resto manda al onboarding.
  import { onMount } from 'svelte';
  import MenuPage from '../menu/MenuPage.svelte';
  import RestaurantForm from '../settings/RestaurantForm.svelte';
  import BackupCard from './BackupCard.svelte';
  import PublishCard from './PublishCard.svelte';
  import CartaQr from './CartaQr.svelte';
  import { loadIdentity, requestPersistence, type LocalIdentity, type PersistResult } from '../../lib/local/identity';
  import { loadOnboarding } from '../../lib/local/onboarding';

  interface Props {
    view: 'carta' | 'ajustes' | 'respaldo' | 'publicar';
  }
  let { view }: Props = $props();

  let ready = $state(false);
  let identity = $state<LocalIdentity | null>(null);
  let configured = $state(false);
  let persist = $state<PersistResult | null>(null);
  let failed = $state<string | null>(null);

  onMount(async () => {
    try {
      identity = await loadIdentity();
      const ob = await loadOnboarding();
      // Con el local creado (paso 3) ya se puede trabajar aunque el onboarding no haya terminado.
      configured = Boolean(identity && (ob.completed || ob.restaurantId));
      if (view === 'ajustes') persist = await requestPersistence();
    } catch (err) {
      failed = (err as Error).message || 'No se pudo abrir Fize en este navegador.';
    } finally {
      ready = true;
    }
  });
</script>

{#if failed}
  <div class="l-page"><p class="l-alert l-alert-error" role="alert">{failed}</p></div>
{:else if !ready}
  <div class="l-page"><p class="l-help">Abriendo Fize…</p></div>
{:else if view === 'respaldo'}
  <div class="l-page">
    <h1 class="l-title">Copia de seguridad</h1>
    <BackupCard />
  </div>
{:else if !configured}
  <div class="l-page">
    <h1 class="l-title">Primero, tu local</h1>
    <p class="l-lead">Este equipo todavía no tiene un local de Fize.</p>
    <div class="l-row">
      <a class="l-btn l-btn-primary" href="/local/">Empezar</a>
      <a class="l-btn" href="/local/respaldo/">Restaurar una copia</a>
    </div>
  </div>
{:else if view === 'carta'}
  <div class="l-page wide">
    <!-- Envoltura de bloque: MenuPage se centra con margin auto y, como hijo flex, se encogeria a su
         contenido minimo (la tabla) y desbordaria en el celular. -->
    <div class="block"><MenuPage /></div>
    <p class="l-help">Cuando cambies precios o platos, vuelve a <a href="/local/publicar/">publicar tu carta</a>.</p>
  </div>
{:else if view === 'publicar'}
  <div class="l-page">
    <h1 class="l-title">Publicar</h1>
    <PublishCard />
    <CartaQr />
  </div>
{:else}
  <div class="l-page wide">
    <h1 class="l-title">Mi local</h1>
    <RestaurantForm />
    <section class="l-card" aria-labelledby="eq-title">
      <h2 id="eq-title">Este equipo</h2>
      <p>Identificador del local: <span class="l-mono" data-testid="instance-id">{identity?.instanceId}</span></p>
      <p>
        {persist === 'granted'
          ? 'Almacenamiento protegido: el navegador no borrará estos datos para liberar espacio.'
          : 'El navegador podría borrar estos datos si le falta espacio. Instala Fize en este equipo y haz copias seguido.'}
      </p>
      <p class="l-help">
        Los datos de este equipo no tienen cifrado propio: los protege el bloqueo del equipo. Pon clave de bloqueo y no
        compartas este navegador con personas ajenas al negocio. Tus copias sí van siempre cifradas.
      </p>
    </section>
  </div>
{/if}

<style>
  .wide { max-width: 72rem; }
  .block { display: block; width: 100%; }
</style>
