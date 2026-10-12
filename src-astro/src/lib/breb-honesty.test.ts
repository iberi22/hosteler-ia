/**
 * Bre-B NO esta integrado. Fi'ze no tiene pasarela de pago.
 *
 * El 2026-10-01 la UI de cobro de OrderCard.svelte decia:
 *   "Fi'ze se conecta al proveedor Bre-B del restaurante para confirmar esto
 *    automaticamente. Por ahora queda registrado a mano."
 *
 * La segunda frase lo desmentia, pero la primera es la que lee el cliente. Es
 * una promesa de capacidad que el producto no tiene: no hay endpoint de
 * webhook, ni integracion con Wompi/MercadoPago/Stripe, ni codigo que asigne
 * `source: 'webhook'`.
 *
 * Estos tests fallan si alguien vuelve a escribir esa promesa en la UI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Todos los .svelte y .astro que renderizan algo visible para el usuario. */
function userFacingFiles(): string[] {
  const out: string[] = [];
  for (const sub of ['components', 'pages', 'layouts']) {
    const dir = join(srcRoot, sub);
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && /\.(svelte|astro)$/.test(entry.name)) {
        out.push(join(entry.parentPath, entry.name));
      }
    }
  }
  return out;
}

/**
 * Frases que prometen una confirmacion automatica de pago.
 * Solo cuentan si aparecen en texto visible, no en un comentario.
 */
const PROMESAS = [
  /se\s+conecta\s+al\s+proveedor/i,
  /confirma\s+autom[áa]ticamente/i,
  /confirmaci[óo]n\s+autom[áa]tica/i,
  /webhook\s+(?:de\s+)?(?:bre-?b|transacci)/i,
  /se\s+confirma\s+s[óo]lo/i,
];

describe('Bre-B: la UI no promete una integracion que no existe', () => {
  const archivos = userFacingFiles();

  it('encuentra los archivos de UI (sanity del propio test)', () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  it('ningun componente promete confirmacion automatica de pago', () => {
    const ofensores: string[] = [];
    for (const f of archivos) {
      const crudo = readFileSync(f, 'utf8');
      // Quita comentarios Svelte/JS y Astro: el texto visible es lo que importa.
      const visible = crudo
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ');
      for (const patron of PROMESAS) {
        if (patron.test(visible)) {
          ofensores.push(`${f.replace(srcRoot + '/', '')} ~ ${patron}`);
        }
      }
    }
    expect(
      ofensores,
      `la UI promete pago automatico en:\n  ${ofensores.join('\n  ')}\n` +
        'Fi' +
        "ze no tiene pasarela integrada. El pago es un asiento de auditoria manual.",
    ).toEqual([]);
  });

  it('el texto de Bre-B explica que el dinero no pasa por Fi' + "'ze", () => {
    // La UI de cobro vive en PaymentForm.svelte (la monta OrderCard.svelte).
    const orderCard = readFileSync(
      join(srcRoot, 'components', 'orders', 'PaymentForm.svelte'),
      'utf8',
    );
    const i = orderCard.indexOf("paymentMethod === 'breb'");
    expect(i, 'no se encontro la rama de Bre-B').toBeGreaterThan(-1);
    const rama = orderCard.slice(i, i + 500);
    expect(rama).toMatch(/la abre el restaurante en su banco/i);
    expect(rama).toMatch(/no valida ni mueve ese dinero/i);
  });
});

describe('Bre-B: la frontera del modulo es honesta', () => {
  const payments = readFileSync(join(srcRoot, 'lib', 'payments.ts'), 'utf8');

  it('WEBHOOK_METHODS esta marcado como inerte, no como capacidad', () => {
    // Si alguien lo conecta de verdad, este test debe cambiar a proposito.
    expect(payments).toMatch(/⚠ INERT/);
    expect(payments).toMatch(/sin ninguna referencia/i);
  });

  it('los metodos de pago siguen siendo los 5 del restaurant', () => {
    expect(payments).toMatch(
      /PAYMENT_METHODS\s*=\s*\['efectivo',\s*'datafone',\s*'breb',\s*'transferencia',\s*'otro'\]/,
    );
  });

  it('no hay endpoint de webhook (si lo hubiera, esta assertion seria falsa)', () => {
    // Verificado a mano el 2026-10-01: no existe pages/api/webhooks/**.
    // Si anades uno, este test te obliga a quitar el aviso INERT.
    const rutas = readdirSync(join(srcRoot, 'pages', 'api'), { recursive: true });
    const hayWebhook = rutas.some((r) => /webhook/i.test(String(r)));
    expect(hayWebhook, 'existe ya un webhook: quita el aviso INERT de payments.ts').toBe(false);
  });
});
