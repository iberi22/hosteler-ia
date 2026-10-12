<script lang="ts">
  // StoryStudio.svelte — /local/historias/: imagenes para los Estados de WhatsApp hechas con la carta del local.
  //
  // Todo pasa en este equipo: la carta se lee con `apiFetch` (en modo local va a IndexedDB, sin red), las imagenes
  // se dibujan con Canvas 2D (`lib/local/storyRender.ts`) y se comparten con el menu de compartir del celular.
  // La foto del plato solo vive en memoria mientras la pagina esta abierta: no se guarda ni se sube.
  // Cada imagen lleva el enlace de la carta publicada para que el cliente la abra y pida por WhatsApp.
  import { onMount } from 'svelte';
  import type { Action } from 'svelte/action';
  import { apiFetch } from '../../lib/api-client';
  import type { DomainRecord } from '../../lib/domain';
  import { isPublicItem } from '../../lib/publicMenuBySlug';
  import { mapCategory, mapMenuItem, type StoreMenuCategory, type StoreMenuItem } from '../../lib/storeSync';
  import { loadIdentity } from '../../lib/local/identity';
  import { getSettings } from '../../lib/local/localDb';
  import { publicMenuUrl } from '../../lib/local/localMode';
  import { loadOnboarding } from '../../lib/local/onboarding';
  import {
    FALLBACK_PALETTES,
    MAX_DISHES_PER_IMAGE,
    STORY_STYLE_IDS,
    formatStoryDate,
    formatStoryPrice,
    paginateDishes,
    shareText,
    shortLink,
    storyFileName,
    type StoryPalette,
    type StoryStyleId,
  } from '../../lib/local/storyLayout';
  import {
    canvasToPng,
    currentThemeStyle,
    preparePhoto,
    readStoryPalettes,
    renderStory,
    type StoryPhoto,
    type StorySpec,
  } from '../../lib/local/storyRender';

  type Template = 'menu' | 'featured' | 'order';

  const TEMPLATES: Array<{ id: Template; label: string; help: string }> = [
    { id: 'menu', label: 'Menú del día', help: 'Varios platos con su precio' },
    { id: 'featured', label: 'Plato destacado', help: 'La receta del día, con foto si quieres' },
    { id: 'order', label: 'Pide aquí', help: 'QR y enlace de tu carta' },
  ];
  const PREFS_KEY = 'fize-historias';
  const TYPING_DEBOUNCE_MS = 250;

  // Datos del local
  let phase = $state<'loading' | 'sin-local' | 'listo' | 'error'>('loading');
  let failed = $state('');
  let restaurant = $state({ name: '', slug: '', phone: '' });
  let categories = $state<StoreMenuCategory[]>([]);
  let dishes = $state<StoreMenuItem[]>([]);
  let published = $state(false);

  // Eleccion
  let template = $state<Template>('menu');
  let style = $state<StoryStyleId>('bone-oscuro');
  let palettes = $state<Record<StoryStyleId, StoryPalette>>(FALLBACK_PALETTES);
  let menuSource = $state<'category' | 'pick'>('category');
  let categoryId = $state('');
  let picked = $state<string[]>([]);
  let featuredId = $state('');
  let photo = $state<StoryPhoto | null>(null);
  let photoName = $state('');
  let photoBusy = $state(false);
  let photoError = $state('');
  let showSafe = $state(false);

  // Textos: el campo responde al instante, la imagen se redibuja cuando se deja de escribir.
  let titleInput = $state('Menú de hoy');
  let labelInput = $state('Receta del día');
  let descInput = $state('');
  let title = $state('Menú de hoy');
  let label = $state('Receta del día');
  let description = $state('');
  $effect(() => {
    const next = { t: titleInput, l: labelInput, d: descInput };
    const timer = setTimeout(() => {
      title = next.t;
      label = next.l;
      description = next.d;
    }, TYPING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  // Acciones
  let canShareFiles = $state(false);
  let busy = $state(false);
  let notice = $state<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  let linkCopied = $state(false);
  let previewEl = $state<HTMLElement | null>(null);

  const today = new Date();
  const dateLabel = formatStoryDate(today);
  const link = $derived(restaurant.slug ? publicMenuUrl(restaurant.slug) : '');
  const palette = $derived(palettes[style]);
  const hasWhatsapp = $derived(restaurant.phone.replace(/\D/g, '').length >= 7);

  const dishesByCategory = $derived(
    categories.map((c) => ({ category: c, items: dishes.filter((d) => d.categoryId === c.id) })).filter((g) => g.items.length > 0),
  );
  const menuDishes = $derived(
    menuSource === 'category' ? dishes.filter((d) => d.categoryId === categoryId) : dishes.filter((d) => picked.includes(d.id)),
  );
  const featuredDish = $derived(dishes.find((d) => d.id === featuredId) ?? null);

  const specs = $derived.by((): StorySpec[] => {
    if (!link) return [];
    const common = { restaurant: restaurant.name, link, hasWhatsapp };
    if (template === 'order') return [{ kind: 'order', ...common }];
    if (template === 'featured') {
      if (!featuredDish) return [];
      return [
        {
          kind: 'featured',
          ...common,
          label,
          dish: { name: featuredDish.name, price: featuredDish.price },
          description,
          photo,
        },
      ];
    }
    const pages = paginateDishes(menuDishes.map((d) => ({ name: d.name, price: d.price })));
    return pages.map((page, i) => ({ kind: 'menu', ...common, title, date: dateLabel, dishes: page, page: i + 1, pages: pages.length }));
  });

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ template, style }));
    } catch {
      /* sin localStorage: se elige de nuevo la proxima vez */
    }
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { template?: unknown; style?: unknown };
      if (TEMPLATES.some((t) => t.id === raw.template)) template = raw.template as Template;
      if (STORY_STYLE_IDS.includes(raw.style as StoryStyleId)) style = raw.style as StoryStyleId;
    } catch {
      /* preferencias dañadas o bloqueadas: valores por defecto */
    }
  }

  async function json<T>(path: string): Promise<T> {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(`No se pudo leer tu carta (${res.status}).`);
    return (await res.json()) as T;
  }

  async function load() {
    const identity = await loadIdentity();
    const ob = await loadOnboarding();
    if (!identity || !(ob.completed || ob.restaurantId)) {
      phase = 'sin-local';
      return;
    }
    const [rests, cats, items] = await Promise.all([
      json<Array<Record<string, unknown>>>('/api/restaurants'),
      json<DomainRecord[]>('/api/categories'),
      json<DomainRecord[]>('/api/menu-items'),
    ]);
    const r = rests[0];
    restaurant = { name: String(r?.name ?? ''), slug: String(r?.slug ?? ''), phone: String(r?.phone ?? '') };
    categories = cats
      .map((c, i) => mapCategory(c, i))
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const alive = new Set(categories.map((c) => c.id));
    // Mismos platos que ve el cliente en la carta publica: visibles, disponibles y con precio.
    dishes = items
      .filter((raw) => isPublicItem(raw as unknown as Record<string, unknown>))
      .map(mapMenuItem)
      .filter((d) => d.isAvailable && Number.isFinite(d.price) && d.price > 0 && alive.has(d.categoryId));
    const settings = await getSettings();
    published = Boolean(settings.lastPublishedAt && settings.publishedSlug === restaurant.slug);

    categoryId = dishesByCategory[0]?.category.id ?? '';
    picked = dishes.slice(0, MAX_DISHES_PER_IMAGE).map((d) => d.id);
    selectFeatured(dishes[0]?.id ?? '');
    phase = 'listo';
  }

  function selectFeatured(id: string) {
    featuredId = id;
    const d = dishes.find((x) => x.id === id);
    descInput = d?.description ?? '';
  }

  onMount(() => {
    style = currentThemeStyle();
    palettes = readStoryPalettes();
    loadPrefs();
    try {
      const probe = new File([new Uint8Array([0])], 'x.png', { type: 'image/png' });
      canShareFiles = typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [probe] });
    } catch {
      canShareFiles = false;
    }
    load().catch((err: unknown) => {
      failed = err instanceof Error ? err.message : 'No se pudo abrir Fize en este navegador.';
      phase = 'error';
    });

    // Si cambia el tema (claro/oscuro) se vuelven a leer los tokens: las imagenes siguen al tema Bone.
    const refresh = () => (palettes = readStoryPalettes());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-font'] });
    return () => {
      media.removeEventListener('change', refresh);
      observer.disconnect();
    };
  });

  // ─── Dibujo ───
  // Cada canvas se redibuja cuando cambia su historia o el estilo, y el PNG se prepara en segundo plano para que
  // "Compartir" no tenga que esperar (en iOS el permiso de compartir dura muy poco despues del toque).
  const pngs = new WeakMap<HTMLCanvasElement, { version: number; blob: Blob }>();
  const versions = new WeakMap<HTMLCanvasElement, number>();

  const paint: Action<HTMLCanvasElement, { spec: StorySpec; palette: StoryPalette }> = (node, initial) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = (args: { spec: StorySpec; palette: StoryPalette }) => {
      try {
        const ms = renderStory(node, args.spec, args.palette);
        node.dataset.renderMs = ms.toFixed(1);
        node.dataset.rendered = 'true';
      } catch (err) {
        notice = { kind: 'error', text: err instanceof Error ? err.message : 'No se pudo dibujar la imagen.' };
        return;
      }
      const version = (versions.get(node) ?? 0) + 1;
      versions.set(node, version);
      clearTimeout(timer);
      timer = setTimeout(() => {
        canvasToPng(node)
          .then((blob) => {
            if (versions.get(node) === version) pngs.set(node, { version, blob });
          })
          .catch(() => {
            /* se vuelve a intentar al compartir */
          });
      }, 400);
    };
    draw(initial);
    return {
      update: draw,
      destroy: () => clearTimeout(timer),
    };
  };

  function canvases(): HTMLCanvasElement[] {
    return previewEl ? Array.from(previewEl.querySelectorAll<HTMLCanvasElement>('canvas[data-story]')) : [];
  }

  async function pngOf(canvas: HTMLCanvasElement): Promise<Blob> {
    const cached = pngs.get(canvas);
    if (cached && cached.version === versions.get(canvas)) return cached.blob;
    return canvasToPng(canvas);
  }

  async function files(): Promise<File[]> {
    const list = canvases();
    const blobs = await Promise.all(list.map(pngOf));
    return blobs.map((b, i) => new File([b], storyFileName(restaurant.slug, today, i + 1), { type: 'image/png' }));
  }

  async function share() {
    notice = null;
    busy = true;
    try {
      const data: ShareData = { files: await files(), text: shareText(restaurant.name, link) };
      if (!navigator.canShare?.(data)) {
        canShareFiles = false;
        notice = { kind: 'warn', text: 'Este navegador no deja compartir imágenes. Descárgala y súbela desde WhatsApp.' };
        return;
      }
      await navigator.share(data);
      notice = { kind: 'ok', text: 'Listo. En WhatsApp elige “Mi estado” y toca enviar.' };
    } catch (err) {
      // Cerrar el menu de compartir no es un error.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        notice = { kind: 'error', text: 'No se pudo compartir. Descarga la imagen y súbela desde WhatsApp.' };
      }
    } finally {
      busy = false;
    }
  }

  async function download(index: number) {
    notice = null;
    const canvas = canvases()[index];
    if (!canvas) return;
    try {
      const blob = await pngOf(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = storyFileName(restaurant.slug, today, index + 1);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      notice = { kind: 'error', text: 'No se pudo descargar la imagen. Inténtalo de nuevo.' };
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      linkCopied = true;
      setTimeout(() => (linkCopied = false), 2000);
    } catch {
      notice = { kind: 'warn', text: `No se pudo copiar. Tu enlace es: ${link}` };
    }
  }

  async function onPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    photoError = '';
    photoBusy = true;
    try {
      photo = await preparePhoto(file);
      photoName = file.name;
    } catch (err) {
      photoError = err instanceof Error ? err.message : 'No se pudo abrir esa foto.';
    } finally {
      photoBusy = false;
    }
  }

  function removePhoto() {
    photo = null;
    photoName = '';
    photoError = '';
  }

  function chooseTemplate(t: Template) {
    template = t;
    savePrefs();
  }

  function chooseStyle(s: StoryStyleId) {
    style = s;
    savePrefs();
  }

  function togglePick(id: string, on: boolean) {
    picked = on ? [...picked, id] : picked.filter((x) => x !== id);
  }

  const imagesLabel = $derived(specs.length === 1 ? 'imagen' : 'imágenes');
</script>

{#if phase === 'loading'}
  <div class="l-page"><p class="l-help">Abriendo Fize…</p></div>
{:else if phase === 'error'}
  <div class="l-page"><p class="l-alert l-alert-error" role="alert">{failed}</p></div>
{:else if phase === 'sin-local'}
  <div class="l-page">
    <h1 class="l-title">Primero, tu local</h1>
    <p class="l-lead">Este equipo todavía no tiene un local de Fize.</p>
    <div class="l-row">
      <a class="l-btn l-btn-primary" href="/local/">Empezar</a>
      <a class="l-btn" href="/local/respaldo/">Restaurar una copia</a>
    </div>
  </div>
{:else}
  <div class="l-page studio">
    <header class="intro">
      <h1 class="l-title">Historias para WhatsApp</h1>
      <p class="l-lead">Crea imágenes para tus estados con tu carta. Cada imagen lleva el enlace de tu carta para que te pidan por WhatsApp.</p>
    </header>

    {#if !restaurant.slug}
      <p class="l-alert l-alert-warn">Primero completa los datos de tu local en <a href="/local/ajustes/">Mi local</a>.</p>
    {:else if !published}
      <p class="l-alert l-alert-warn" data-testid="no-publicada">
        Tu carta todavía no está publicada: el enlace y el QR de las imágenes no abrirán nada hasta que la publiques.
        <a href="/local/publicar/">Publicar mi carta</a>
      </p>
    {/if}

    <div class="layout">
      <div class="controls">
        <section class="l-card" aria-labelledby="h-tpl">
          <h2 id="h-tpl">1. ¿Qué quieres publicar?</h2>
          <div class="choices" role="radiogroup" aria-labelledby="h-tpl">
            {#each TEMPLATES as t (t.id)}
              <label class="choice" class:on={template === t.id}>
                <input type="radio" name="tpl" value={t.id} checked={template === t.id} onchange={() => chooseTemplate(t.id)} />
                <span class="choice-title">{t.label}</span>
                <span class="choice-help">{t.help}</span>
              </label>
            {/each}
          </div>
        </section>

        <section class="l-card" aria-labelledby="h-opts">
          <h2 id="h-opts">2. Ajusta tu historia</h2>
          {#if template === 'menu'}
            <div class="l-field">
              <label for="st-title">Título</label>
              <input id="st-title" class="l-input" maxlength="60" bind:value={titleInput} />
              <p class="l-help">Fecha: {dateLabel}.</p>
            </div>
            {#if dishes.length === 0}
              <p class="l-alert l-alert-warn">Tu carta no tiene platos disponibles con precio. Agrégalos en <a href="/local/carta/">Carta</a>.</p>
            {:else}
              <fieldset class="l-field">
                <legend class="l-label">Platos</legend>
                <div class="l-row">
                  <label class="inline"><input type="radio" name="src" value="category" bind:group={menuSource} /> Una categoría</label>
                  <label class="inline"><input type="radio" name="src" value="pick" bind:group={menuSource} /> Elegir platos</label>
                </div>
              </fieldset>
              {#if menuSource === 'category'}
                <div class="l-field">
                  <label for="st-cat">Categoría</label>
                  <select id="st-cat" class="l-input" bind:value={categoryId}>
                    {#each dishesByCategory as g (g.category.id)}
                      <option value={g.category.id}>{g.category.name} ({g.items.length})</option>
                    {/each}
                  </select>
                </div>
              {:else}
                <div class="pick" role="group" aria-label="Platos de la historia">
                  {#each dishesByCategory as g (g.category.id)}
                    <p class="pick-cat">{g.category.name}</p>
                    {#each g.items as d (d.id)}
                      <label class="pick-item">
                        <input type="checkbox" checked={picked.includes(d.id)} onchange={(e) => togglePick(d.id, e.currentTarget.checked)} />
                        <span class="pick-name">{d.name}</span>
                        <span class="pick-price">{formatStoryPrice(d.price)}</span>
                      </label>
                    {/each}
                  {/each}
                </div>
              {/if}
              <p class="l-help" data-testid="menu-count">
                {menuDishes.length} {menuDishes.length === 1 ? 'plato' : 'platos'}
                {#if specs.length > 1}— van en {specs.length} imágenes (máximo {MAX_DISHES_PER_IMAGE} por imagen para que se lean bien).{/if}
              </p>
            {/if}
          {:else if template === 'featured'}
            {#if dishes.length === 0}
              <p class="l-alert l-alert-warn">Tu carta no tiene platos disponibles con precio. Agrégalos en <a href="/local/carta/">Carta</a>.</p>
            {:else}
              <div class="l-field">
                <label for="st-dish">Plato</label>
                <select id="st-dish" class="l-input" value={featuredId} onchange={(e) => selectFeatured(e.currentTarget.value)}>
                  {#each dishesByCategory as g (g.category.id)}
                    <optgroup label={g.category.name}>
                      {#each g.items as d (d.id)}<option value={d.id}>{d.name} — {formatStoryPrice(d.price)}</option>{/each}
                    </optgroup>
                  {/each}
                </select>
              </div>
              <div class="l-field">
                <label for="st-label">Etiqueta</label>
                <input id="st-label" class="l-input" maxlength="30" bind:value={labelInput} />
              </div>
              <div class="l-field">
                <label for="st-desc">Descripción corta</label>
                <textarea id="st-desc" class="l-input" rows="3" maxlength="220" bind:value={descInput} placeholder="Ej.: con arroz, patacón y ensalada"></textarea>
              </div>
              <div class="l-field">
                <span class="l-label">Foto (opcional)</span>
                <div class="l-row">
                  <label class="l-btn file-btn">
                    <input type="file" accept="image/*" capture="environment" class="file-input" onchange={onPhoto} />
                    Tomar foto
                  </label>
                  <label class="l-btn file-btn">
                    <input type="file" accept="image/*" class="file-input" onchange={onPhoto} />
                    Elegir de la galería
                  </label>
                  {#if photo}<button type="button" class="l-btn l-btn-link" onclick={removePhoto}>Quitar foto</button>{/if}
                </div>
                {#if photoBusy}<p class="l-help">Preparando la foto…</p>{/if}
                {#if photo && photoName}<p class="l-help" data-testid="photo-name">Foto: {photoName}</p>{/if}
                {#if photoError}<p class="l-error" role="alert">{photoError}</p>{/if}
                <p class="l-help">La foto solo se usa para dibujar la imagen en este equipo: no se guarda ni se sube a internet.</p>
              </div>
            {/if}
          {:else}
            <p>Un QR grande y el enlace de tu carta. Tus clientes lo escanean o tocan el enlace del estado y te piden por WhatsApp.</p>
            {#if !hasWhatsapp}
              <p class="l-alert l-alert-warn">Tu local no tiene WhatsApp: la carta se verá, pero no podrán pedir por ahí. Agrégalo en <a href="/local/ajustes/">Mi local</a>.</p>
            {/if}
          {/if}
        </section>

        <section class="l-card" aria-labelledby="h-style">
          <h2 id="h-style">3. Estilo</h2>
          <div class="styles" role="radiogroup" aria-labelledby="h-style">
            {#each STORY_STYLE_IDS as id (id)}
              <label class="style" class:on={style === id}>
                <input type="radio" name="style" value={id} checked={style === id} onchange={() => chooseStyle(id)} />
                <span class="swatch" style:background={palettes[id].bg} aria-hidden="true">
                  <span class="swatch-a" style:background={palettes[id].accent}></span>
                  <span class="swatch-t" style:color={palettes[id].text}>Aa</span>
                </span>
                <span>{palettes[id].label}</span>
              </label>
            {/each}
          </div>
        </section>
      </div>

      <section class="l-card preview-card" aria-labelledby="h-prev">
        <h2 id="h-prev">Vista previa</h2>
        {#if specs.length === 0}
          <p class="l-help">
            {template === 'featured' ? 'Elige un plato para ver la imagen.' : 'Elige al menos un plato para ver la imagen.'}
          </p>
        {:else}
          <div class="previews" bind:this={previewEl} data-testid="previews">
            {#each specs as spec, i (`${template}-${i}`)}
              <figure class="frame">
                <div class="phone">
                  <canvas
                    data-story={i + 1}
                    width="1080"
                    height="1920"
                    use:paint={{ spec, palette }}
                  >Historia {i + 1} de {specs.length} para tu estado de WhatsApp</canvas>
                  {#if showSafe}
                    <span class="safe safe-top" aria-hidden="true"></span>
                    <span class="safe safe-bottom" aria-hidden="true"></span>
                  {/if}
                </div>
                <figcaption>
                  {#if specs.length > 1}<span class="l-help">Imagen {i + 1} de {specs.length}</span>{/if}
                  <button type="button" class="l-btn small" onclick={() => download(i)}>
                    {specs.length > 1 ? `Descargar imagen ${i + 1}` : 'Descargar imagen'}
                  </button>
                </figcaption>
              </figure>
            {/each}
          </div>
          <label class="inline safe-toggle"><input type="checkbox" bind:checked={showSafe} /> Mostrar lo que tapa WhatsApp</label>

          <div class="actions">
            {#if canShareFiles}
              <button type="button" class="l-btn l-btn-primary share" disabled={busy} onclick={share}>
                {busy ? 'Preparando…' : 'Compartir en WhatsApp'}
              </button>
            {/if}
            <button type="button" class="l-btn" onclick={copyLink}>{linkCopied ? 'Enlace copiado' : 'Copiar enlace de la carta'}</button>
          </div>
          {#if notice}
            <p class="l-alert {notice.kind === 'ok' ? 'l-alert-ok' : notice.kind === 'warn' ? 'l-alert-warn' : 'l-alert-error'}" role="status">{notice.text}</p>
          {/if}
          <p class="l-help">Enlace en {specs.length === 1 ? 'la imagen' : 'las imágenes'}: <span class="l-mono">{shortLink(link)}</span></p>

          <details class="howto">
            <summary>¿Cómo la publico como estado?</summary>
            {#if canShareFiles}
              <ol>
                <li>Toca <strong>Compartir en WhatsApp</strong> y elige <strong>WhatsApp</strong>.</li>
                <li>Arriba de tus chats elige <strong>Mi estado</strong> y toca enviar.</li>
                <li>El enlace de tu carta va en el texto del estado: tus clientes lo tocan y te piden.</li>
              </ol>
            {:else}
              <ol>
                <li>Toca <strong>Descargar {imagesLabel === 'imagen' ? 'imagen' : 'cada imagen'}</strong>: queda en tu galería o en Descargas.</li>
                <li>En WhatsApp abre <strong>Novedades</strong> (Estados) y toca el ícono de la cámara.</li>
                <li>Elige la imagen, pega el enlace de tu carta con <strong>Copiar enlace</strong> y envía.</li>
              </ol>
            {/if}
          </details>
        {/if}
      </section>
    </div>
  </div>
{/if}

<style>
  .studio { max-width: 72rem; }
  .intro { display: flex; flex-direction: column; gap: 0.375rem; }
  .layout { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); align-items: start; }
  @media (min-width: 900px) {
    .layout { grid-template-columns: minmax(0, 1fr) minmax(0, 22rem); }
    .preview-card { position: sticky; top: 1rem; }
  }
  .controls { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  fieldset { border: 0; }
  .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 0.5rem; }
  .choice, .style {
    position: relative; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.75rem;
    border: 1px solid var(--swal-border-strong, var(--swal-border)); border-radius: var(--swal-radius, 0.75rem);
    cursor: pointer; background: var(--swal-bg-elevated, var(--swal-bg)); color: var(--swal-text);
  }
  .choice.on, .style.on { border-color: var(--swal-accent); box-shadow: 0 0 0 1px var(--swal-accent) inset; }
  .choice input, .style input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .choice:has(input:focus-visible), .style:has(input:focus-visible), .file-btn:has(input:focus-visible) {
    outline: 2px solid var(--swal-accent); outline-offset: 2px;
  }
  .choice-title { font-weight: 650; font-size: 0.9375rem; }
  .choice-help { font-size: 0.8125rem; color: var(--swal-text-secondary); line-height: 1.35; }
  .styles { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: 0.5rem; }
  .style { align-items: flex-start; font-size: 0.875rem; font-weight: 600; }
  .swatch {
    position: relative; display: flex; align-items: center; justify-content: center; width: 100%; height: 3rem;
    border-radius: var(--swal-radius-sm, 8px); border: 1px solid var(--swal-border); overflow: hidden;
  }
  .swatch-a { position: absolute; left: 0.5rem; bottom: 0.5rem; width: 1.25rem; height: 0.375rem; border-radius: 99px; }
  .swatch-t { font-weight: 800; font-size: 1.125rem; }
  .inline { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.9375rem; color: var(--swal-text); min-height: 2.75rem; }
  .pick { display: flex; flex-direction: column; gap: 0.125rem; max-height: 22rem; overflow: auto; padding-right: 0.25rem; }
  .pick-cat { font-size: 0.8125rem; font-weight: 650; color: var(--swal-text-secondary); margin-top: 0.5rem; }
  .pick-item { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; color: var(--swal-text); font-size: 0.9375rem; }
  .pick-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .pick-price { color: var(--swal-text-secondary); white-space: nowrap; }
  textarea.l-input { resize: vertical; min-height: 5rem; }
  .file-btn { position: relative; overflow: hidden; }
  .file-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  .previews { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; }
  .frame { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
  .phone {
    position: relative; width: min(100%, 16.875rem); aspect-ratio: 9 / 16; border-radius: 1.25rem; overflow: hidden;
    border: 1px solid var(--swal-border-strong, var(--swal-border)); box-shadow: var(--swal-shadow);
  }
  .phone canvas { display: block; width: 100%; height: 100%; }
  .safe { position: absolute; left: 0; right: 0; background: rgba(220, 38, 38, 0.28); border: 1px dashed rgba(220, 38, 38, 0.9); }
  .safe-top { top: 0; height: 11.46%; }
  .safe-bottom { bottom: 0; height: 13.54%; }
  figcaption { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; }
  .small { min-height: 2.75rem; font-size: 0.875rem; padding: 0.5rem 0.875rem; }
  .safe-toggle { align-self: center; }
  .actions { display: flex; flex-direction: column; gap: 0.5rem; }
  .actions .l-btn { width: 100%; }
  .howto summary { cursor: pointer; font-weight: 600; color: var(--swal-text); min-height: 2.75rem; display: flex; align-items: center; }
  .howto ol { padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.25rem; }
</style>
