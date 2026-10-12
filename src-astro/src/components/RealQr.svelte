<script lang="ts">
  // RealQr.svelte — QR ESCANEABLE con qrcode-generator (0-dep, corre offline).
  // No confundir con QRCode.svelte (placeholder visual no escaneable, H1.06).
  // Props: value (texto), size (px), level (L/M/Q/H).
  import qrcode from 'qrcode-generator';
  import { assertSafeSvg } from '../lib/qrSanitize';

  let { value = '', size = 200, level = 'M', title = 'QR code', class: klass = '' } = $props<{
    value?: string; size?: number; level?: 'L' | 'M' | 'Q' | 'H'; title?: string; class?: string;
  }>();

  let svg = $derived.by(() => {
    if (!value) return '';
    try {
      const qr = qrcode(0, level);
      qr.addData(value);
      qr.make();
      const rawSvg = qr.createSvgTag({ scalable: true });
      return assertSafeSvg(rawSvg);
    } catch {
      return '';
    }
  });
</script>

<div class="realqr {klass}" style="width:{size}px;" role="img" aria-label={title}>
  {#if svg}
    {@html svg}
  {:else}
    <p class="realqr-err">QR no disponible</p>
  {/if}
</div>

<style>
  .realqr { display: grid; place-items: center; background: white; border-radius: 8px; padding: 0.5rem; }
  .realqr :global(svg) { width: 100%; height: auto; display: block; }
  .realqr-err { color: var(--swal-danger); font-size: 0.8rem; }
</style>
