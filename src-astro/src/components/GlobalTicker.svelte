<script lang="ts">
  import { GlobalTicker as SwalGlobalTicker } from '@swal/ui';

  export interface TickerItem {
    text: string;
    type?: 'info' | 'warning' | 'error' | 'success' | 'orange';
  }

  interface Props {
    items?: TickerItem[];
    speed?: 'slow' | 'normal' | 'fast';
    interactive?: boolean;
    paused?: boolean;
  }

  let {
    items = [
      // La marca se escribe siempre "Fi’ze": la cinta ya no pasa el texto a
      // mayusculas, asi que aqui tampoco se escribe en mayusculas.
      { text: 'Sistema Fi’ze operativo', type: 'success' },
      { text: 'Red local mesh activa · sincro en segundos', type: 'info' },
      { text: 'Modo demo: pruebas libres habilitadas', type: 'orange' },
      { text: 'KDS y menú QR: conexión segura', type: 'info' },
    ],
    speed = 'normal',
    interactive = true,
    paused = false,
  }: Props = $props();
</script>

<!-- Ticker global delgado para alertas y estado operativo -->
<div class="global-ticker-wrapper">
  <SwalGlobalTicker {items} {speed} {interactive} {paused} />
</div>

<style>
  .global-ticker-wrapper {
    width: 100%;
    position: relative;
    z-index: 10;
  }
</style>
