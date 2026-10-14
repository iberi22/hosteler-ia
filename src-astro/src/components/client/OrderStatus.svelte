<script lang="ts">
  // OrderStatus.svelte — confirmacion de pedido con sondeo del estado publico.
  // Consulta GET /api/public-order/{id} cada 10 s hasta un estado final (pagado o cancelado).
  import { onMount } from 'svelte';
  import type { OrderStatus } from '../../lib/orderStateMachine';

  interface Props {
    orderId: string;
    instanceId: string;
    tableNumber?: string;
    cartaHref?: string;
  }

  let { orderId, instanceId, tableNumber = '', cartaHref = '' }: Props = $props();

  let label = $state('');
  let status: OrderStatus | '' = $state('');

  onMount(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (interval) clearInterval(interval);
    };

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/public-order/${encodeURIComponent(orderId)}?instance_id=${encodeURIComponent(instanceId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { status?: OrderStatus; label?: string };
        if (stopped || !data.status) return;
        status = data.status;
        label = data.label ?? '';
        if (status === 'paid' || status === 'cancelled') stop();
      } catch {
        // Un fallo de red no rompe la pantalla: se reintenta en el siguiente ciclo.
      }
    };

    poll();
    interval = setInterval(poll, 10_000);
    return stop;
  });
</script>

<div class="order-status" role="status" aria-live="polite">
  <p>
    <strong>{label || '¡Listo! Tu pedido llegó a la cocina.'}</strong>
  </p>
  {#if tableNumber}<p>Mesa {tableNumber}</p>{/if}
  <p>Si necesitas algo, llama al mesero.</p>
  {#if cartaHref}<p><a class="back" href={cartaHref}>Volver a la carta</a></p>{/if}
</div>

<style>
  .order-status { padding: 1rem; border: 1px solid var(--swal-border, #1e293b); border-radius: 0.6rem; }
  .back { color: var(--swal-accent, #06b6d4); }
</style>
