<script lang="ts">
  // CartSidebar.svelte — carrito cliente con indicador offline + envío con fallback
  import { cart, removeItem, updateQuantity, clearCart, setTableId } from '../../stores/cart.svelte';
  import {
    enqueueOrder,
    getPendingOrders,
    postOrder,
    registerBackgroundSync,
    syncOrders,
  } from '../../lib/offlineQueue';
  import { cartTotals, buildOrderPayload } from '../../lib/cartView';
  import { formatCOP } from '../../lib/money';

  interface Props {
    tableId?: string | null;
    tableLabel?: string;
  }

  let { tableId = null, tableLabel = '' }: Props = $props();

  let status = $state('');
  let pendingCount = $state(0);

  $effect(() => {
    if (tableId) setTableId(tableId);
    void refreshPending();
    // Al volver la conexion se reenvia la cola; el pedido solo sale de ella
    // cuando el servidor responde 2xx.
    const retry = () => void retryQueue();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  });

  async function retryQueue() {
    if ((await getPendingOrders().catch(() => [])).length === 0) return;
    const res = await syncOrders().catch(() => ({ synced: 0, failed: 1 }));
    await refreshPending();
    if (res.synced > 0 && pendingCount === 0) status = 'Pedido enviado a cocina';
  }

  async function refreshPending() {
    try {
      pendingCount = (await getPendingOrders()).length;
    } catch {
      pendingCount = 0;
    }
  }

  const totals = $derived(cartTotals(cart.items));

  async function submit() {
    if (!cart.tableId || cart.items.length === 0) return;
    status = 'Enviando…';
    const payload = buildOrderPayload(cart.tableId, cart.items);
    try {
      const res = await postOrder(payload);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const order = await res.json();
      clearCart();
      window.location.href = `/order-confirmation/${order.id}`;
    } catch (err) {
      // Distinguir "no hay red" de "el servidor nos rechazo". Antes caia todo
      // en el mismo camino: un 401 decia "pedido guardado, se enviara solo",
      // pero la cola solo se reenvia si el service worker la despierta y no
      // siempre lo hace, asi que el pedido se perdia en silencio.
      // OJO: `httpStatus`, no `status`. `status` es el texto que ve el cliente;
      // sombrearlo con el codigo dejaba la pantalla en "Enviando…" para siempre.
      const httpStatus = err instanceof Error ? Number(/HTTP (\d+)/.exec(err.message)?.[1] ?? 0) : 0;
      const rejected = httpStatus >= 400 && httpStatus < 500;
      if (rejected) {
        // El servidor recibio el pedido y no lo acepto. Encolarlo seria
        // prometer un envio que no va a pasar: se avisa y se reintenta a mano.
        status = `El local no pudo tomar el pedido (error ${httpStatus}). Inténtalo de nuevo.`;
        return;
      }
      await enqueueOrder({
        tableId: payload.tableId,
        items: payload.items,
        status: 'pending',
      });
      await registerBackgroundSync();
      // Reintento inmediato: si la red vuelve ya, el pedido sale sin esperar.
      // Si no, queda en la cola y se reintenta al evento `online`.
      const res = await syncOrders().catch(() => ({ synced: 0, failed: 1 }));
      await refreshPending();
      if (res.synced > 0 && pendingCount === 0) {
        clearCart();
        status = 'Pedido enviado a cocina';
        window.location.reload();
        return;
      }
      // Nunca se dice "enviado": el pedido sigue en el telefono.
      status = 'No se pudo enviar. Avísale al mesero; lo reintentaremos cuando vuelva la conexión.';
      clearCart();
    }
  }
</script>

<aside class="cart" aria-label="Carrito">
  <h2>Tu pedido {tableLabel ? `· ${tableLabel}` : ''}</h2>
  {#if cart.items.length === 0}
    <p>Carrito vacío. Añade platos de la carta.</p>
  {:else}
    <ul>
      {#each cart.items as item}
        <li>
          <span>{item.name} × {item.quantity}</span>
          <span>{formatCOP(item.totalPrice)}</span>
          <button onclick={() => updateQuantity(item.id, item.quantity + 1)} aria-label="Más">+</button>
          <button onclick={() => updateQuantity(item.id, item.quantity - 1)} aria-label="Menos">−</button>
          <button onclick={() => removeItem(item.id)} aria-label="Quitar">✕</button>
        </li>
      {/each}
    </ul>
    <p><strong>Total: {formatCOP(totals.subtotal)} ({totals.count} platos)</strong></p>
    <button class="send" onclick={submit}>Enviar a cocina</button>
  {/if}
  {#if pendingCount > 0}
    <p class="offline" role="status">📴 {pendingCount} pedido(s) pendientes de envío</p>
  {/if}
  {#if status}
    <p role="status">{status}</p>
  {/if}
</aside>

<style>
  .cart { border: 1px solid var(--swal-border, #1e293b); border-radius: 0.6rem; padding: 1rem; background: var(--swal-surface, #0f0f10); }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  li { display: flex; gap: 0.5rem; align-items: center; justify-content: space-between; }
  .send { width: 100%; padding: 0.7rem; border: none; border-radius: 0.5rem; background: var(--swal-accent, #06b6d4); color: var(--swal-bg); font-weight: 700; cursor: pointer; }
  .offline { color: var(--swal-warning); }
</style>
