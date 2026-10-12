// payments.ts — registro de pagos del pedido.
//
// Bre-B (el webhook) es la via automatica y llega en una entrega posterior.
// Este modulo es el puente que permite al restaurante cobrar HOY: el mismo
// registro de pago que consumira el webhook mas adelante, de modo que la
// auditoria no se parte en dos sistemas.
//
// La llave Bre-B la crea el COMERCIO en su banco, no Fi'ze. Fi'ze solo
// registra lo que el restaurante ya cobro por su cuenta (efectivo, datafone,
// Bre-B, transferencia) con metodo, monto y quien lo cobro.

/** Metodos de pago que el restaurante puede registrar a mano. */
export const PAYMENT_METHODS = ['efectivo', 'datafone', 'breb', 'transferencia', 'otro'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Metodos que CONFIRMA UN PROVEEDOR EXTERNO, no una persona.
 *
 * ⚠ INERT: exportado pero sin ninguna referencia. No hay endpoint de webhook
 * en el repo, ni pasarela integrada, ni codigo que asigne `source: 'webhook'`.
 * Se conserva solo para marcar la frontera honesta del modulo: hoy todo pago
 * entra a mano. Si algun dia se integra Bre-B de verdad, este es el punto de
 * entrada (un POST /api/webhooks/breb) y hay que BORRAR este aviso en el mismo
 * commit que lo conecte. Borrarlo antes seria mentir sobre la capacidad.
 */
export const WEBHOOK_METHODS = ['breb', 'transferencia'] as const;

export interface PaymentRecord {
  id: string;
  instance_id: string;
  orderId: string;
  amount: number;
  method: PaymentMethod;
  /** 'manual' lo registro una persona; 'webhook' lo confirmo un proveedor. */
  source: 'manual' | 'webhook';
  /** Referencia externa: id del datafone, id de la transaccion Bre-B, etc. */
  reference?: string;
  /** Usuario que registro el pago (para el caso manual). */
  recordedBy?: string;
  /** Momento del cobro. */
  recorded_at: string;
  /**
   * `created_at` lo exige la columna NOT NULL de sealed_meta; sin el el INSERT
   * falla en D1 y el pago se queda solo en la memoria del isolate (parecia
   * guardado en la respuesta de la API pero se perdia al siguiente request).
   * `recorded_at` y `created_at` son el mismo instante en un pago.
   */
  created_at: string;
}

export interface PaymentValidation {
  ok: boolean;
  errors: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// El total vive en la app publica (el tablero lo usa sin el modulo de cobro).
export { orderTotal } from './orderTotal';

/**
 * Valida un pago antes de guardarlo.
 * - el monto debe ser positivo
 * - debe coincidir (o cubrir) el total del pedido
 * - el metodo debe estar en la lista cerrada
 */
export function validatePayment(input: {
  amount: number;
  method: string;
  orderTotal: number;
}): PaymentValidation {
  const errors: string[] = [];

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push('El monto debe ser mayor que cero');
  }

  if (!PAYMENT_METHODS.includes(input.method as PaymentMethod)) {
    errors.push(`Metodo de pago invalido: ${input.method}`);
  }

  const total = round2(Number(input.orderTotal));
  if (Number.isFinite(amount) && total > 0 && amount + 0.009 < total) {
    errors.push(`El monto (${amount}) es menor que el total del pedido (${total})`);
  }

  return { ok: errors.length === 0, errors };
}

/** Construye el registro de pago listo para persistir. */
export function buildPayment(input: {
  orderId: string;
  instanceId: string;
  amount: number;
  method: PaymentMethod;
  source: 'manual' | 'webhook';
  reference?: string;
  recordedBy?: string;
  now?: string;
}): PaymentRecord {
  const at = input.now ?? new Date().toISOString();
  return {
    id: `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    instance_id: input.instanceId,
    orderId: input.orderId,
    amount: round2(Number(input.amount)),
    method: input.method,
    source: input.source,
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.recordedBy ? { recordedBy: input.recordedBy } : {}),
    recorded_at: at,
    created_at: at,
  };
}
