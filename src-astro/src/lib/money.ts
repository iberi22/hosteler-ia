// money.ts — formato de moneda unico para Fi'ze.
// Colombia: pesos colombianos (COP), sin decimales (la costumbre local es
// "18.000" y no "18.000,00"). Centralizar aqui evita que cada componente
// invente su propio formato y que aparezca "18.000,00 EUR" en un menu
// colombiano.

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Formatea un monto en pesos colombianos: 18000 -> "$ 18.000" */
export function formatCOP(amount: number): string {
  if (!Number.isFinite(amount)) return COP.format(0);
  return COP.format(amount);
}

/** Formatea un monto sin el simbolo, para inputs de formulario. */
export function formatPlain(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(amount);
}
