<script lang="ts">
  // CheckoutPanel.svelte — revisa carrito y confirma pedido (sin pagos en MVP)
  import { cart, clearCart } from '../../stores/cart.svelte';
  import { cartTotals, buildOrderPayload } from '../../lib/cartView';
  import { enqueueOrder, postOrder } from '../../lib/offlineQueue';
  import { formatCOP } from '../../lib/money';

  let error = $state('');
  let sending = $state(false);

  const totals = $derived(cartTotals(cart.items));

  async function confirm() {
    if (!cart.tableId || cart.items.length === 0) {
      error = 'Carrito vacío o sin mesa asignada';
      return;
    }
    error = '';
    sending = true;
    const payload = buildOrderPayload(cart.tableId, cart.items);
    try {
      const res = await postOrder(payload);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const order = await res.json();
      clearCart();
      window.location.href = `/order-confirmation/${order.id}`;
    } catch {
      await enqueueOrder({
        tableId: payload.tableId,
        items: payload.items,
        status: 'pending',
      });
      error = 'No se pudo enviar. Avísale al mesero; lo reintentaremos cuando vuelva la conexión.';
      clearCart();
    } finally {
      sending = false;
    }
  }
</script>

<section class="checkout">
  <h1>Revisar pedido</h1>
  {#if cart.items.length === 0}
    <p>Tu carrito está vacío.</p>
    <p><a class="back" href="/">Volver a la carta</a></p>
  {:else}
    <p>Mesa: {cart.tableId ?? '—'}</p>
    <ul>
      {#each cart.items as item}
        <li>{item.name} × {item.quantity} — {formatCOP(item.totalPrice)}</li>
      {/each}
    </ul>
    <p><strong>Total: {formatCOP(totals.subtotal)}</strong></p>
    <p class="note">Sin pagos en esta versión: el pedido va directo a cocina.</p>
    <button onclick={confirm} disabled={sending}>{sending ? 'Enviando…' : 'Confirmar pedido'}</button>
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
</section>

<style>
  .checkout { max-width: 32rem; margin: 2rem auto; padding: 1.5rem; }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  button { padding: 0.7rem 1.2rem; border: none; border-radius: 0.5rem; background: var(--swal-accent, #06b6d4); color: var(--swal-bg); font-weight: 700; cursor: pointer; }
  button:disabled { opacity: 0.6; }
  .note { opacity: 0.7; font-size: 0.9rem; }
  .error { color: #f87171; }
  .back { color: var(--swal-accent, #06b6d4); }
</style>
