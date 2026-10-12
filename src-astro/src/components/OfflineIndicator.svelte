<script lang="ts">
  // OfflineIndicator.svelte — banner online/offline + cola pendiente
  import { getPendingOrders, syncOrders } from '../lib/offlineQueue';
  import { pendingMutations } from '../lib/idbSync';
  import { queueMessage, shouldShowBanner } from '../lib/connectivity';

  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  let orders = $state(0);
  let mutations = $state(0);

  async function refresh() {
    try {
      orders = (await getPendingOrders()).length;
    } catch {
      orders = 0;
    }
    try {
      mutations = (await pendingMutations()).length;
    } catch {
      mutations = 0;
    }
  }

  $effect(() => {
    void refresh();
    const on = () => {
      online = true;
      // Reenvia los pedidos guardados; solo salen de la cola con un 2xx.
      void syncOrders().catch(() => undefined).finally(refresh);
    };
    const off = () => {
      online = false;
      void refresh();
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });

  const message = $derived(queueMessage(orders, mutations, online));
  const show = $derived(shouldShowBanner(orders, mutations, online));
</script>

{#if show}
  <div class="offline-banner" class:offline={!online} role="status">{message}</div>
{/if}

<style>
  .offline-banner {
    padding: 0.5rem 1rem;
    text-align: center;
    font-size: 0.85rem;
    background: var(--swal-accent, #06b6d4);
    color: var(--swal-bg);
  }
  .offline-banner.offline { background: var(--swal-warning); color: var(--swal-bg); }
</style>
