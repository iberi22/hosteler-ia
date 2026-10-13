<script lang="ts">
  import { onMount } from 'svelte';
  import { Modal, Button } from '@swal/ui';
  import RealQr from '../RealQr.svelte';
  import { apiFetch } from '../../lib/api-client';
  import { getSettings } from '../../lib/local/localDb';
  import { isLocalMode } from '../../lib/local/localMode';
  import { resolveTableQrUrl } from '../../lib/local/tableQr';

  type Table = { id: string; number: number; capacity: number; qrCode: string; status?: string };

  let { open = false, table = null as Table | null, onclose = () => {} } = $props<{ open?: boolean; table?: Table | null; onclose?: () => void }>();

  let copied = $state(false);

  // En /local/* no hay cuenta ni servidor: el unico QR valido para el comensal es el de la carta
  // publicada (QA pre-entrega 2026-10-13 #4). El `qrCode` interno solo sirve en el dashboard.
  const local = isLocalMode();
  let slug = $state('');
  let published = $state(false);

  let qrUrl = $derived(
    resolveTableQrUrl({
      local,
      table,
      slug,
      published,
      origin: typeof window !== 'undefined' ? window.location?.origin : undefined,
    }),
  );

  onMount(async () => {
    if (!local) return;
    try {
      const res = await apiFetch('/api/restaurants');
      const list = res.ok ? ((await res.json()) as Array<Record<string, unknown>>) : [];
      const nextSlug = String(list[0]?.slug ?? '');
      slug = nextSlug;
      const settings = await getSettings();
      published = Boolean(settings.lastPublishedAt && settings.publishedSlug === nextSlug);
    } catch {
      // Sin datos locales el dialogo cae en el aviso de Publicar, nunca en un enlace roto.
    }
  });

  async function copy() {
    if (!qrUrl || typeof navigator === 'undefined') return;
    await navigator.clipboard.writeText(qrUrl);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<Modal {open} title={table ? `Mesa ${table.number} — QR` : 'QR'} onclose={onclose}>
  {#if table && qrUrl}
    <div class="qr-dialog">
      <RealQr value={qrUrl} size={180} title={`QR mesa ${table.number}`} />
      <div class="link">{qrUrl}</div>
      <Button variant={copied ? 'primary' : 'ghost'} onclick={copy}>{copied ? 'Copiado' : 'Copiar link'}</Button>
    </div>
  {:else if table && local}
    <div class="qr-dialog">
      <p>Tu carta todavía no está publicada.</p>
      <p class="hint">El QR de la mesa {table.number} se activa al publicarla: abre tu carta en el celular del comensal con su número de mesa.</p>
      <Button variant="primary" href="/local/publicar/">Ir a Publicar</Button>
    </div>
  {/if}
</Modal>

<style>
  .qr-dialog { display: grid; place-items: center; gap: 0.75rem; }
  .link { font-family: var(--swal-font-mono); font-size: 0.85rem; color: var(--swal-text-secondary); word-break: break-all; }
  .hint { font-size: 0.85rem; color: var(--swal-text-muted); text-align: center; margin: 0; }
</style>
