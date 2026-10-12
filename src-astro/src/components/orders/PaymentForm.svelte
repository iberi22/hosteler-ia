<!--
  PaymentForm.svelte — registro manual de cobro de un pedido (metodo + monto). No mueve dinero: deja
  constancia de lo que el restaurante ya cobro (efectivo, datafono, Bre-B, transferencia).
  Lo monta OrderCard.svelte al pasar served -> paid. POST /api/orders/[id]/payment; en 201 entrega el
  cuerpo `{ order, payment }` a onPaid.
-->
<script lang="ts">
  import { formatCOP } from '../../lib/money';
  import { api } from '../../lib/api-client';
  import { PAYMENT_METHODS, type PaymentMethod } from '../../lib/payments';

  interface PaymentFormProps {
    orderId: string;
    total: number;
    /** Cuerpo JSON de la respuesta 201 de POST /api/orders/[id]/payment (`{ order, payment }`). */
    onPaid: (body: unknown) => void;
    onCancel: () => void;
  }

  let { orderId, total, onPaid, onCancel }: PaymentFormProps = $props();

  let paymentMethod = $state<PaymentMethod>('efectivo');
  // svelte-ignore state_referenced_locally
  let paymentAmount = $state(String(total));
  let errorMsg = $state<string | null>(null);
  let isSaving = $state(false);

  async function confirmPayment() {
    if (isSaving) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errorMsg = 'El monto debe ser mayor que cero';
      return;
    }
    isSaving = true;
    errorMsg = null;

    try {
      const res = await api.post(`/api/orders/${encodeURIComponent(orderId)}/payment`, {
        method: paymentMethod,
        amount,
      });
      if (res.ok) {
        onPaid(await res.json());
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
        errorMsg =
          data.details?.join(' ') || data.error || `Error ${res.status}: no se pudo registrar el pago`;
      }
    } catch {
      errorMsg = 'Error de conexión con el servidor';
    } finally {
      isSaving = false;
    }
  }
</script>

<div class="payment" role="group" aria-label="Registrar pago">
  <p class="payment-title">¿Cómo se cobró? Total {formatCOP(total)}</p>
  <div class="payment-methods">
    {#each PAYMENT_METHODS as m (m)}
      <button
        type="button"
        class="chip"
        class:active={paymentMethod === m}
        onclick={() => (paymentMethod = m)}
      >
        {m}
      </button>
    {/each}
  </div>
  <label class="payment-amount">
    <span>Monto cobrado</span>
    <input
      type="number"
      min="0"
      step="1"
      bind:value={paymentAmount}
      placeholder={String(total)}
      aria-label="Monto cobrado"
    />
  </label>
  <p class="payment-hint">
    {#if paymentMethod === 'breb'}
      Registra aquí el pago que ya recibiste por tu cuenta. La cuenta Bre-B
      la abre el restaurante en su banco: Fi'ze no valida ni mueve ese dinero,
      solo deja constancia de lo que ya cobraste.
    {:else}
      Registra el pago que ya hiciste por tu cuenta. Ni Fi'ze ni el restaurante
      reciben el dinero por este medio: es un asiento de auditoría.
    {/if}
  </p>
  {#if errorMsg}
    <p class="error-msg" role="alert">⚠️ {errorMsg}</p>
  {/if}
  <div class="payment-actions">
    <button type="button" class="btn primary" onclick={confirmPayment} disabled={isSaving}>
      {isSaving ? 'Guardando...' : 'Confirmar cobro'}
    </button>
    <button type="button" class="btn ghost" onclick={onCancel}>
      Cancelar
    </button>
  </div>
</div>

<style>
  .payment {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.85rem;
    border: 1px solid var(--swal-border, #1e293b);
    border-radius: 0.7rem;
    background: color-mix(in srgb, var(--swal-surface, #111827) 85%, transparent);
  }

  .payment-title {
    margin: 0;
    font-weight: 700;
    font-size: 0.9rem;
  }

  .payment-methods {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip {
    border: 1px solid var(--swal-border, #1e293b);
    border-radius: 999px;
    padding: 0.3rem 0.65rem;
    font-size: 0.78rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .chip.active {
    background: var(--swal-neon-cyan, #22d3ee);
    color: var(--swal-bg);
    border-color: transparent;
  }

  .payment-amount {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
  }
  .payment-amount input {
    border: 1px solid var(--swal-border, #1e293b);
    border-radius: 0.45rem;
    padding: 0.45rem 0.6rem;
    background: transparent;
    color: inherit;
    font-size: 0.95rem;
  }

  .payment-hint {
    margin: 0;
    font-size: 0.72rem;
    opacity: 0.65;
    line-height: 1.4;
  }

  .error-msg {
    margin: 0;
    padding: 0.45rem 0.65rem;
    background: rgba(239, 68, 68, 0.12);
    border-left: 3px solid var(--swal-danger);
    border-radius: 4px;
    color: var(--swal-danger);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .payment-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn {
    flex: 1;
    padding: 0.55rem 0.75rem;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    border: 1px solid var(--swal-border);
    background: var(--swal-bg-elevated);
    color: var(--swal-text);
    transition: transform 0.12s ease, background 0.12s ease;
  }
  .btn:hover:not(:disabled) { transform: translateY(-1px); }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--swal-accent-cyan);
    color: #0a0a0a;
    border-color: var(--swal-accent-cyan);
  }
  .btn.primary:hover:not(:disabled) { background: var(--swal-cyan-bright, #06b6d4); }
  .btn.ghost {
    background: transparent;
    color: var(--swal-text-secondary);
  }
  .btn.ghost:hover:not(:disabled) {
    color: var(--swal-accent-orange);
    border-color: var(--swal-accent-orange);
  }
  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
    .btn:hover { transform: none; }
  }
</style>
