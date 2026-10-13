<script lang="ts">
  // Onboarding.svelte — primer uso del modo local (docs/producto/NODO-LOCAL.md §4).
  // Seis pasos; el avance queda en IndexedDB (`fize-local`), asi que se puede cerrar y retomar.
  // Ningun paso llama a la red: todo `/api/*` lo atiende la API local (lib/local/localApi.ts).
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/api-client';
  import { suggestSlug, validateSlug, validateWhatsapp } from '../../lib/restaurantRules';
  import { ensureIdentity, requestPersistence, type PersistResult } from '../../lib/local/identity';
  import { getLocal, setLocal } from '../../lib/local/localDb';
  import { formatRecoveryCode, generateRecoveryCode, normalizeRecoveryCode } from '../../lib/local/backupCrypto';
  import { exportBackupFile } from '../../lib/local/backupData';
  import { PUBLIC_ORIGIN } from '../../lib/local/localMode';
  import {
    createCategoryApi,
    createMenuItemApi,
    deleteMenuItemApi,
    fetchCategoriesApi,
    fetchMenuItemsApi,
  } from '../../lib/menuSync';
  import type { StoreMenuCategory, StoreMenuItem } from '../../lib/storeSync';
  import { formatCOP } from '../../lib/money';
  import { parseCopPrice } from '../../lib/copPrice';
  import CloudLevels from './CloudLevels.svelte';
  import PublishCard from './PublishCard.svelte';
  import { ONBOARDING_STEPS, type OnboardingState } from '../../lib/local/onboarding';

  interface Props {
    initial: OnboardingState;
    onDone: () => void;
  }
  let { initial, onDone }: Props = $props();

  const TOTAL = ONBOARDING_STEPS;
  let ob = $state<OnboardingState>({ ...initial });
  let heading = $state<HTMLHeadingElement | null>(null);

  async function save() {
    await setLocal('onboarding', $state.snapshot(ob));
  }

  async function go(step: number) {
    ob.step = step;
    await save();
    await enter(step);
    heading?.focus();
    window.scrollTo({ top: 0 });
  }

  // --- Paso 2: almacenamiento e instalacion --------------------------------
  interface InstallEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
  let persist = $state<PersistResult | null>(null);
  let installEvent = $state<InstallEvent | null>(null);
  let installed = $state(false);
  let isIos = $state(false);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installed = outcome === 'accepted';
    installEvent = null;
  }

  // --- Paso 3: datos del local ----------------------------------------------
  let name = $state('');
  let slug = $state('');
  let slugTouched = $state(false);
  let phone = $state('');
  let address = $state('');
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  let serverError = $state<string | null>(null);

  async function loadRestaurant() {
    const res = await apiFetch('/api/restaurants');
    if (!res.ok) return;
    const list = (await res.json()) as Array<Record<string, unknown>>;
    const r = list.find((x) => x.id === ob.restaurantId) ?? list[0];
    if (!r) return;
    ob.restaurantId = String(r.id);
    name = String(r.name ?? '');
    slug = String(r.slug ?? '');
    slugTouched = true;
    address = String(r.address ?? '');
    const p = String(r.phone ?? '');
    phone = p.startsWith('57') && p.length === 12 ? `+57 ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8)}` : p;
  }

  async function saveLocal(e: Event) {
    e.preventDefault();
    serverError = null;
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Escribe el nombre de tu negocio.';
    const slugError = validateSlug(slug);
    if (slugError) errs.slug = slugError;
    const wa = validateWhatsapp(phone);
    if (!wa.ok) errs.phone = wa.error;
    if (!address.trim()) errs.address = 'Escribe la dirección: sale en tu carta para que te encuentren.';
    errors = errs;
    if (Object.keys(errs).length > 0) return;

    saving = true;
    try {
      // La llave del restaurante y la instancia local nacen aqui (y solo una vez).
      await ensureIdentity();
      const body = { name: name.trim(), slug: slug.trim(), address: address.trim(), phone: wa.ok ? wa.phone : '' };
      const res = ob.restaurantId
        ? await apiFetch(`/api/restaurants/${encodeURIComponent(ob.restaurantId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await apiFetch('/api/restaurants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        serverError = typeof data.error === 'string' ? data.error : 'No se pudieron guardar los datos.';
        return;
      }
      ob.restaurantId = String(data.id);
      await go(4);
    } catch (err) {
      serverError = (err as Error).message || 'No se pudieron guardar los datos.';
    } finally {
      saving = false;
    }
  }

  // --- Paso 4: codigo de recuperacion --------------------------------------
  let recovery = $state('');
  let wroteItDown = $state(false);
  let downloaded = $state(false);
  let downloading = $state(false);
  let backupError = $state<string | null>(null);

  async function prepareRecovery() {
    let stored = await getLocal<string>('recoveryCode');
    if (!stored) {
      stored = normalizeRecoveryCode(generateRecoveryCode()) ?? '';
      await setLocal('recoveryCode', stored);
    }
    recovery = formatRecoveryCode(stored);
  }

  async function downloadFirst() {
    downloading = true;
    backupError = null;
    try {
      await exportBackupFile();
      downloaded = true;
    } catch (err) {
      backupError = (err as Error).message || 'No se pudo crear la copia.';
    } finally {
      downloading = false;
    }
  }

  async function confirmRecovery() {
    ob.recoveryConfirmed = true;
    recovery = ''; // se mostro una sola vez
    await go(5);
  }

  // --- Paso 5: carta y publicar --------------------------------------------
  let cats = $state<StoreMenuCategory[]>([]);
  let items = $state<StoreMenuItem[]>([]);
  let newCat = $state('');
  let dishName = $state('');
  let dishPrice = $state('');
  let dishCat = $state('');
  let menuError = $state<string | null>(null);
  let menuBusy = $state(false);

  async function loadMenu() {
    try {
      [cats, items] = await Promise.all([fetchCategoriesApi(), fetchMenuItemsApi()]);
      if (!dishCat && cats[0]) dishCat = cats[cats.length - 1].id;
    } catch (err) {
      menuError = (err as Error).message;
    }
  }

  async function addCategory(e: Event) {
    e.preventDefault();
    if (!newCat.trim()) return;
    menuBusy = true;
    menuError = null;
    // Se limpia antes de guardar: lo que se escriba mientras tanto no se pierde al terminar.
    const catName = newCat.trim();
    newCat = '';
    try {
      const c = await createCategoryApi({ name: catName });
      cats = [...cats, c];
      dishCat = c.id;
    } catch (err) {
      newCat = catName;
      menuError = (err as Error).message;
    } finally {
      menuBusy = false;
    }
  }

  async function addDish(e: Event) {
    e.preventDefault();
    menuError = null;
    // Parser compartido (src/lib/copPrice.ts): "32.000" son 32.000 pesos. Antes vivia
    // aqui una copia que aceptaba basura ("12abc" -> 12) sin validar los miles.
    const price = parseCopPrice(dishPrice);
    if (!dishName.trim()) return void (menuError = 'Escribe el nombre del plato.');
    if (!dishCat) return void (menuError = 'Primero crea una categoría (por ejemplo, Almuerzos).');
    if (price === null || price <= 0) return void (menuError = 'Escribe el precio en pesos, por ejemplo 16000.');
    menuBusy = true;
    const name = dishName.trim();
    const rawPrice = dishPrice;
    dishName = '';
    dishPrice = '';
    try {
      const item = await createMenuItemApi({ name, price, categoryId: dishCat });
      items = [...items, item];
    } catch (err) {
      dishName = name;
      dishPrice = rawPrice;
      menuError = (err as Error).message;
    } finally {
      menuBusy = false;
    }
  }

  async function removeDish(id: string) {
    try {
      await deleteMenuItemApi(id);
      items = items.filter((i) => i.id !== id);
    } catch (err) {
      menuError = (err as Error).message;
    }
  }

  async function toPublish() {
    if (items.length === 0 && !globalThis.confirm?.('Tu carta no tiene platos todavía. ¿Seguir de todos modos?')) return;
    ob.phase5 = 'publicar';
    await save();
    heading?.focus();
  }

  // --- Paso 6 ----------------------------------------------------------------
  async function finish() {
    ob.completed = true;
    ob.completedAt = new Date().toISOString();
    await save();
    onDone();
  }

  async function enter(step: number) {
    if (step === 2 && persist === null) persist = await requestPersistence();
    if (step === 3) await loadRestaurant();
    // El codigo se muestra una sola vez: confirmado, el paso 4 ya no lo vuelve a pintar.
    if (step === 4 && ob.recoveryConfirmed) return go(5);
    if (step === 4) await prepareRecovery();
    if (step === 5) await loadMenu();
  }

  onMount(() => {
    const ua = navigator.userAgent;
    isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    installed =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installEvent = e as InstallEvent;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    void enter(ob.step);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  });

  const slugPreview = $derived(slug || 'tu-negocio');
</script>

<div class="ob l-page">
  <header class="ob-head">
    <span class="brand">Fize</span>
    <span class="count" data-testid="paso">Paso {ob.step} de {TOTAL}</span>
  </header>
  <div class="bar" role="progressbar" aria-label="Avance" aria-valuemin="1" aria-valuemax={TOTAL} aria-valuenow={ob.step}>
    <span style="width: {(ob.step / TOTAL) * 100}%"></span>
  </div>

  {#if ob.step === 1}
    <section class="l-card step" aria-labelledby="s1">
      <h1 id="s1" class="l-title" tabindex="-1" bind:this={heading}>Fize ordena tu carta y tu local</h1>
      <p class="l-lead">Sin cuenta. Sin mensualidad. Funciona sin internet.</p>
      <ul class="points">
        <li><strong>Hoy en este equipo:</strong> armas tu carta, la publicas con un QR y los pedidos te llegan por WhatsApp.</li>
        <li><strong>Pronto:</strong> pedidos a cocina, inventario y recetas, también en este equipo.</li>
        <li>No te pedimos correo ni teléfono personal.</li>
      </ul>
      <div class="l-row l-stack-mobile">
        <button type="button" class="l-btn l-btn-primary" onclick={() => go(2)}>Empezar</button>
        <a class="l-btn l-btn-link" href="/local/respaldo/">Ya tengo una copia de Fize</a>
      </div>
    </section>
  {:else if ob.step === 2}
    <section class="l-card step" aria-labelledby="s2">
      <h1 id="s2" class="l-title" tabindex="-1" bind:this={heading}>Tus datos viven en este equipo</h1>
      <svg class="device" viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="2.5" /><path d="M16 40h16M24 33v7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>
      <p class="l-lead">
        Todo se guarda aquí, en este navegador. No creamos ninguna cuenta y SWAL no ve tus datos. Lo que publiques (tu
        carta) sí será público.
      </p>
      <p>
        Si borras los datos del navegador, cambias de navegador o pierdes el equipo, Fize se borra de aquí. Por eso en el
        paso 4 te damos un código y una copia para recuperarlo todo.
      </p>
      {#if persist === 'granted'}
        <p class="l-alert l-alert-ok" role="status" data-testid="persist">Protegido: el navegador no borrará tus datos para liberar espacio.</p>
      {:else if persist !== null}
        <p class="l-alert l-alert-warn" role="status" data-testid="persist">
          El navegador podría borrar estos datos si le falta espacio. Instala Fize en este equipo para protegerlos y haz copias seguido.
        </p>
      {/if}
      {#if isIos && !installed}
        <p class="l-alert l-alert-warn">
          En iPhone y iPad, Safari borra los datos de las páginas que no usas en 7 días. Instala Fize: toca
          <strong>Compartir</strong> y luego <strong>Agregar a inicio</strong>, y abre Fize siempre desde ese ícono.
        </p>
      {/if}
      <div class="l-row l-stack-mobile">
        {#if installed}
          <span class="l-badge">Fize ya está instalado en este equipo</span>
        {:else if installEvent}
          <button type="button" class="l-btn" onclick={install}>Instalar Fize en este equipo</button>
        {:else if !isIos}
          <p class="l-help">Para instalarlo: en el menú del navegador elige “Instalar aplicación” o “Agregar a la pantalla de inicio”.</p>
        {/if}
      </div>
      <div class="l-row nav">
        <button type="button" class="l-btn l-btn-link" onclick={() => go(1)}>Atrás</button>
        <button type="button" class="l-btn l-btn-primary" onclick={() => go(3)}>Siguiente</button>
      </div>
    </section>
  {:else if ob.step === 3}
    <section class="l-card step" aria-labelledby="s3">
      <h1 id="s3" class="l-title" tabindex="-1" bind:this={heading}>Tu local</h1>
      <p>Estos datos salen en tu carta pública cuando la publiques.</p>
      <form class="form" onsubmit={saveLocal} novalidate>
        <div class="l-field">
          <label for="ob-name">Nombre del negocio</label>
          <input id="ob-name" class="l-input" autocomplete="organization" bind:value={name} aria-invalid={errors.name ? 'true' : undefined} aria-describedby={errors.name ? 'ob-name-err' : undefined}
            oninput={() => { if (!slugTouched) slug = suggestSlug(name); }} placeholder="Doña Rosa" />
          {#if errors.name}<p id="ob-name-err" class="l-error">{errors.name}</p>{/if}
        </div>
        <div class="l-field">
          <label for="ob-phone">WhatsApp para pedidos</label>
          <input id="ob-phone" class="l-input" type="tel" inputmode="tel" autocomplete="tel" bind:value={phone} placeholder="+57 300 123 4567"
            aria-invalid={errors.phone ? 'true' : undefined} aria-describedby="ob-phone-help" />
          {#if errors.phone}<p class="l-error">{errors.phone}</p>{/if}
          <p id="ob-phone-help" class="l-help">Aquí te llegan los pedidos de la carta. Puedes dejarlo vacío y ponerlo después.</p>
        </div>
        <div class="l-field">
          <label for="ob-address">Dirección</label>
          <input id="ob-address" class="l-input" autocomplete="street-address" bind:value={address} placeholder="Cra 15 # 85-20, Bogotá" aria-invalid={errors.address ? 'true' : undefined} />
          {#if errors.address}<p class="l-error">{errors.address}</p>{/if}
        </div>
        <div class="l-field">
          <label for="ob-slug">Enlace de tu carta</label>
          <div class="slug-row">
            <span class="l-mono prefix">{PUBLIC_ORIGIN.replace('https://', '')}/</span>
            <input id="ob-slug" class="l-input l-mono" autocapitalize="off" spellcheck="false" bind:value={slug} oninput={() => (slugTouched = true)}
              aria-invalid={errors.slug ? 'true' : undefined} aria-describedby="ob-slug-help" />
            <span class="l-mono prefix">/menu</span>
          </div>
          {#if errors.slug}<p class="l-error">{errors.slug}</p>{/if}
          <p id="ob-slug-help" class="l-help">Así quedará: <span class="l-mono">{PUBLIC_ORIGIN.replace('https://', '')}/{slugPreview}/menu</span>. Solo minúsculas, números y guiones.</p>
        </div>
        {#if serverError}<p class="l-alert l-alert-error" role="alert">{serverError}</p>{/if}
        <div class="l-row nav">
          <button type="button" class="l-btn l-btn-link" onclick={() => go(2)}>Atrás</button>
          <button type="submit" class="l-btn l-btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Siguiente'}</button>
        </div>
      </form>
    </section>
  {:else if ob.step === 4}
    <section class="l-card step" aria-labelledby="s4">
      <h1 id="s4" class="l-title" tabindex="-1" bind:this={heading}>Si pierdes este equipo</h1>
      <p class="l-lead">Sin una copia, se pierde todo. Con este código abres tus copias en cualquier otro equipo.</p>
      <div class="code-box">
        <span class="l-label">Tu código de recuperación</span>
        <output class="code l-mono" data-testid="recovery-code" aria-live="polite">{recovery}</output>
      </div>
      <ul class="points">
        <li>Anótalo en papel y guárdalo lejos de este equipo. <strong>Solo se muestra esta vez.</strong></li>
        <li>SWAL no guarda este código ni una llave de rescate: si pierdes el equipo, las copias y el código, nadie puede recuperar tus datos.</li>
      </ul>
      <div class="l-row l-stack-mobile" data-no-print>
        <button type="button" class="l-btn" onclick={() => window.print()}>Imprimir</button>
        <button type="button" class="l-btn" onclick={downloadFirst} disabled={downloading}>
          {downloading ? 'Cifrando…' : downloaded ? 'Copia descargada ✓' : 'Descargar primera copia (.fize)'}
        </button>
      </div>
      {#if backupError}<p class="l-alert l-alert-error" role="alert">{backupError}</p>{/if}
      <label class="check" data-no-print>
        <input type="checkbox" bind:checked={wroteItDown} />
        <span>Ya lo anoté en un lugar seguro</span>
      </label>
      <div class="l-row nav" data-no-print>
        <button type="button" class="l-btn l-btn-link" onclick={() => go(3)}>Atrás</button>
        <button type="button" class="l-btn l-btn-primary" disabled={!wroteItDown && !downloaded} onclick={confirmRecovery}>Siguiente</button>
      </div>
      {#if !wroteItDown && !downloaded}<p class="l-help" data-no-print>Para seguir, marca que lo anotaste o descarga la primera copia.</p>{/if}
    </section>
  {:else if ob.step === 5 && ob.phase5 !== 'publicar'}
    <section class="l-card step" aria-labelledby="s5">
      <h1 id="s5" class="l-title" tabindex="-1" bind:this={heading}>Tu primera carta</h1>
      <p>Agrega rápido tus categorías y platos. Fotos, descripciones y detalles los completas después en “Carta”.</p>
      <form class="l-row inline-form" onsubmit={addCategory}>
        <div class="l-field grow">
          <label for="ob-cat">Nueva categoría</label>
          <input id="ob-cat" class="l-input" bind:value={newCat} placeholder="Almuerzos" />
        </div>
        <button type="submit" class="l-btn" disabled={menuBusy || !newCat.trim()}>Agregar categoría</button>
      </form>
      <form class="dish-form" onsubmit={addDish}>
        <div class="l-field">
          <label for="ob-dish">Plato</label>
          <input id="ob-dish" class="l-input" bind:value={dishName} placeholder="Ejecutivo del día" />
        </div>
        <div class="l-field">
          <label for="ob-price">Precio (COP)</label>
          <input id="ob-price" class="l-input" inputmode="numeric" bind:value={dishPrice} placeholder="16000" />
        </div>
        <div class="l-field">
          <label for="ob-dish-cat">Categoría</label>
          <select id="ob-dish-cat" class="l-input" bind:value={dishCat} disabled={cats.length === 0}>
            {#each cats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
        </div>
        <button type="submit" class="l-btn l-btn-primary" disabled={menuBusy || cats.length === 0}>Agregar plato</button>
      </form>
      {#if menuError}<p class="l-alert l-alert-error" role="alert">{menuError}</p>{/if}

      {#if cats.length === 0}
        <p class="l-help">Tu carta está vacía. Empieza por una categoría, por ejemplo “Almuerzos” o “Bebidas”.</p>
      {:else}
        <div class="menu-list" aria-label="Tu carta">
          {#each cats as c (c.id)}
            <div class="menu-cat">
              <h2>{c.name}</h2>
              <ul>
                {#each items.filter((i) => i.categoryId === c.id) as i (i.id)}
                  <li><span>{i.name}</span><span class="price">{formatCOP(i.price)}</span>
                    <button type="button" class="l-btn l-btn-link small" aria-label={`Quitar ${i.name}`} onclick={() => removeDish(i.id)}>Quitar</button></li>
                {:else}
                  <li class="l-help">Sin platos todavía.</li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
      <div class="l-row nav">
        <button type="button" class="l-btn l-btn-link" onclick={() => go(6)}>Saltar por ahora</button>
        <button type="button" class="l-btn l-btn-primary" onclick={toPublish}>Seguir</button>
      </div>
    </section>
  {:else if ob.step === 5}
    <h1 class="l-title" tabindex="-1" bind:this={heading}>Publica tu carta</h1>
    <PublishCard showTitle={false} />
    <p class="l-help">Puedes publicar ahora o después desde “Publicar”. Mientras tanto, todo queda guardado en este equipo.</p>
    <div class="l-row nav">
      <button type="button" class="l-btn l-btn-link" onclick={async () => { ob.phase5 = 'carta'; await save(); await loadMenu(); }}>Atrás</button>
      <button type="button" class="l-btn l-btn-primary" onclick={() => go(6)}>Seguir</button>
    </div>
  {:else}
    <h1 class="l-title" tabindex="-1" bind:this={heading}>Después, si quieres</h1>
    <p class="l-lead">Fize funciona completo en este equipo. Esto es lo que puedes sumar más adelante. Nada de esto es obligatorio.</p>
    <CloudLevels />
    <div class="l-row nav">
      <button type="button" class="l-btn l-btn-link" onclick={() => go(5)}>Atrás</button>
      <button type="button" class="l-btn l-btn-primary" onclick={finish}>Ir a mi panel</button>
    </div>
  {/if}
</div>

<style>
  .ob { gap: 0.875rem; }
  .ob-head { display: flex; justify-content: space-between; align-items: baseline; }
  .brand { font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.8125rem; color: var(--swal-text-muted); }
  .count { font-size: 0.875rem; color: var(--swal-text-secondary); }
  .bar { height: 4px; border-radius: 4px; background: var(--swal-border); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--swal-accent); transition: width 200ms; }
  .step { gap: 1rem; }
  .l-title:focus { outline: none; }
  .points { display: flex; flex-direction: column; gap: 0.5rem; padding-left: 1.125rem; }
  .device { width: 3rem; height: 3rem; color: var(--swal-text-secondary); }
  .nav { justify-content: space-between; margin-top: 0.25rem; }
  .form { display: flex; flex-direction: column; gap: 0.875rem; }
  .slug-row { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
  .slug-row .l-input { flex: 1 1 8rem; min-width: 0; }
  .prefix { font-size: 0.8125rem; color: var(--swal-text-muted); }
  .code-box { display: flex; flex-direction: column; gap: 0.375rem; padding: 1rem; border: 2px dashed var(--swal-border-strong, var(--swal-border)); border-radius: var(--swal-radius-lg, 1rem); align-items: center; }
  .code { font-size: clamp(1.0625rem, 5.2vw, 1.875rem); font-weight: 700; letter-spacing: 0.06em; color: var(--swal-text); white-space: nowrap; }
  .check { display: flex; gap: 0.625rem; align-items: center; font-size: 1rem; color: var(--swal-text); min-height: 2.75rem; cursor: pointer; }
  .check input { width: 1.25rem; height: 1.25rem; accent-color: var(--swal-accent); }
  .inline-form { align-items: flex-end; }
  .grow { flex: 1 1 12rem; }
  .dish-form { display: grid; grid-template-columns: 2fr 1fr 1.4fr auto; gap: 0.625rem; align-items: end; }
  @media (max-width: 640px) { .dish-form { grid-template-columns: 1fr 1fr; } .dish-form > :first-child { grid-column: 1 / -1; } .dish-form .l-btn { grid-column: 1 / -1; } }
  .menu-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .menu-cat h2 { font-size: 0.8125rem !important; text-transform: uppercase; letter-spacing: 0.06em; color: var(--swal-text-secondary) !important; margin-bottom: 0.25rem; }
  .menu-cat ul { list-style: none; display: flex; flex-direction: column; }
  .menu-cat li { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0; border-bottom: 1px solid var(--swal-border); color: var(--swal-text) !important; }
  .menu-cat li span:first-child { flex: 1; }
  .price { font-variant-numeric: tabular-nums; }
  .small { min-height: 2rem; font-size: 0.8125rem; }
  @media print {
    .ob-head, .bar, .points + * { display: none; }
  }
</style>
