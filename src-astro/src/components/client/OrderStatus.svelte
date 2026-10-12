<script lang="ts">
  // OrderStatus.svelte — confirmacion fija del pedido.
  // Sin sondeo: GET /api/orders/{id} es privado (401 para el comensal) y el
  // estado nunca cambiaba, solo gastaba ~1.200 peticiones por hora y pestana.
  interface Props {
    tableNumber?: string;
    cartaHref?: string;
  }

  let { tableNumber = '', cartaHref = '' }: Props = $props();
</script>

<div class="order-status" role="status">
  <p><strong>¡Listo! Tu pedido llegó a la cocina.</strong></p>
  {#if tableNumber}<p>Mesa {tableNumber}</p>{/if}
  <p>Si necesitas algo, llama al mesero.</p>
  {#if cartaHref}<p><a class="back" href={cartaHref}>Volver a la carta</a></p>{/if}
</div>

<style>
  .order-status { padding: 1rem; border: 1px solid var(--swal-border, #1e293b); border-radius: 0.6rem; }
  .back { color: var(--swal-accent, #06b6d4); }
</style>
