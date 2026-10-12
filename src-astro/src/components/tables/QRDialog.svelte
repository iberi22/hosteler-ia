<script lang="ts">
  import { Modal, Button } from '@swal/ui';
  import RealQr from '../RealQr.svelte';

  type Table = { id: string; number: number; capacity: number; qrCode: string; status?: string };

  let { open = false, table = null as Table | null, onclose = () => {} } = $props<{ open?: boolean; table?: Table | null; onclose?: () => void }>();

  let copied = $state(false);

  let qrUrl = $derived.by(() => {
    if (!table?.qrCode) return '';
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/table/${table.qrCode}`;
    }
    return `/table/${table.qrCode}`;
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
  {/if}
</Modal>

<style>
  .qr-dialog { display: grid; place-items: center; gap: 0.75rem; }
  .link { font-family: var(--swal-font-mono); font-size: 0.85rem; color: var(--swal-text-secondary); word-break: break-all; }
</style>
