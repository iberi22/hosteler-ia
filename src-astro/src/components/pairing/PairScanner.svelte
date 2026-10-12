<script lang="ts">
  // PairScanner.svelte — escanea QR de pairing con BarcodeDetector (nativo, sin deps).
  // Sin cámara o sin BarcodeDetector → fallback manual (ManualJoin).
  // Emite scanned(text) con el texto crudo del QR; P6 lo valida con parsePairingText.
  import ManualJoin from './ManualJoin.svelte';

  interface Detector {
    detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
  }

  let { onScanned = (_text: string) => {}, onManualJoin = (_code: string) => {}, scanning = true } = $props<{
    onScanned?: (text: string) => void; onManualJoin?: (code: string) => void; scanning?: boolean;
  }>();

  let videoEl: HTMLVideoElement | null = $state(null);
  let status: 'idle' | 'live' | 'unsupported' | 'denied' | 'done' = $state('idle');
  let stream: MediaStream | null = null;
  let raf = 0;
  let detector: Detector | null = null;

  async function start() {
    status = 'idle';
    const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) {
      status = 'unsupported';
      return;
    }
    try {
      detector = new BD({ formats: ['qr_code'] });
    } catch {
      status = 'unsupported';
      return;
    }
    try {
      const withTimeout = Promise.race([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('camera-timeout')), 4000)),
      ]);
      stream = await withTimeout;
    } catch {
      status = 'denied';
      return;
    }
    if (videoEl) {
      videoEl.srcObject = stream;
      try { await videoEl.play(); } catch { /* autoplay bloqueado: usuario da play */ }
    }
    status = 'live';
    loop();
  }

  async function loop() {
    if (status !== 'live' || !detector || !videoEl) return;
    try {
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        const found = await detector.detect(videoEl);
        if (found.length > 0 && found[0].rawValue) {
          stop();
          status = 'done';
          onScanned(found[0].rawValue);
          return;
        }
      }
    } catch { /* frame no legible: reintenta */ }
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  $effect(() => {
    if (scanning) start();
    return () => stop();
  });
</script>

<div class="scanner" data-status={status}>
  {#if status === 'live' || status === 'idle'}
    <video bind:this={videoEl} class="scanner-video" playsinline muted></video>
    <p class="scanner-hint">Apunta al QR de la otra tablet</p>
  {:else if status === 'done'}
    <p class="scanner-hint">QR leído, uniendo…</p>
  {:else}
    <p class="scanner-hint">
      {status === 'denied' ? 'Cámara bloqueada: permite acceso o usa el código.' : 'Este dispositivo no escanea: usa el código.'}
    </p>
    <ManualJoin onJoin={onManualJoin} />
  {/if}
</div>

<style>
  .scanner { display: grid; gap: 0.5rem; }
  .scanner-video { width: 100%; max-height: 260px; object-fit: cover; border-radius: 8px; background: black; }
  .scanner-hint { font-size: 0.85rem; color: var(--swal-text-muted); margin: 0; text-align: center; }
</style>
