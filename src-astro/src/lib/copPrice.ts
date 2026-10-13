// copPrice.ts — el unico parser de precios en pesos colombianos de Fi'ze.
//
// En Colombia el precio se escribe con punto (o coma) de miles y sin decimales:
// "38.000". `parseFloat("38.000")` devuelve 38, asi que el plato se guardaba 1000
// veces mas barato y el cobro salia mal (QA pre-entrega 2026-10-13, #1: dinero).
//
// Aqui vive la unica regla, la misma para la carta, el onboarding y el cobro:
//   - "." y "," son SIEMPRE separadores de miles (nunca decimales).
//   - El resultado es un entero de pesos.
//   - Cualquier otra cosa (letras, decimales, simbolos raros, vacio) es error:
//     devuelve `null`. Es dinero; guardar un numero inventado es peor que pedir
//     que lo escriban otra vez.
//
// Onboarding tenia su propio `parsePrice` (`Number(raw.replace(/[^\d]/g, ''))`),
// que aceptaba basura ("12abc" -> 12) y no validaba los grupos de miles. Este
// modulo es la extraccion de aquella funcion, endurecida.

/** Espacios (normal, fino, duro) y el simbolo de peso: no forman parte del numero. */
const CURRENCY_NOISE = /[\s\u00a0\u202f$]/g;

/**
 * Convierte lo que el usuario escribio en un entero de pesos, o `null` si es error.
 *
 * - `"38000"` -> `38000`
 * - `"38.000"` -> `38000`
 * - `"$ 38.000"` -> `38000`
 * - `"1.250.000"` -> `1250000`
 * - `"38,000"` -> `38000`
 * - `"abc"`, `""`, `"38.5"`, `"12,50"`, `"3.8000"`, `"-500"` -> `null`
 */
export function parseCopPrice(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).replace(CURRENCY_NOISE, '');
  if (!text) return null;
  // O todos los digitos, o grupos de miles bien formados (1-3 digitos y bloques de 3).
  // El segundo grupo es el que rechaza "38.5" y "3.8000": son decimales o grupos rotos
  // y multiplicarian o dividirian el precio sin que nadie lo note.
  if (!/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(text)) return null;
  const value = Number(text.replace(/[.,]/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}

/** Igual que `parseCopPrice` pero lanza, para el codigo que quiere una excepcion explicita. */
export function parseCopPriceOrThrow(raw: unknown): number {
  const value = parseCopPrice(raw);
  if (value === null) throw new Error('Precio inválido: escríbelo en pesos, por ejemplo 38.000');
  return value;
}
