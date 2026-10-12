// Smoke de SOLO LECTURA contra una URL desplegada (produccion o version preview de Cloudflare):
// carta publica -> carrito (3 platos) -> enlace de WhatsApp, en movil y desktop. No envia pedidos.
// Uso: node --experimental-strip-types scripts/smoke-public-menu.mjs <baseUrl> [dirCapturas] [slug]
import { chromium } from '@playwright/test';
import { resolveChromiumExecutablePath } from './resolve-chromium.ts';

const [base, out = '.', slug = 'restaurante-demo'] = process.argv.slice(2);
if (!base) throw new Error('falta baseUrl');
const executablePath = resolveChromiumExecutablePath();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const problems = [];
for (const [name, viewport] of [['movil', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${name} ${r.status()} ${new URL(r.url()).pathname}`));
  await page.goto(`${base}/${slug}/menu`, { waitUntil: 'networkidle' });
  const add = page.getByRole('button', { name: /^Añadir / });
  const n = Math.min(3, await add.count());
  for (let i = 0; i < n; i++) await add.nth(i).click();
  const hrefs = await page.locator('a[href*="wa.me"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  if (n === 0) problems.push(`${name}: la carta no tiene platos`);
  if (hrefs.length === 0) problems.push(`${name}: sin enlace de WhatsApp tras añadir ${n} platos`);
  else console.log(`${name}: ${n} platos, ${decodeURIComponent(hrefs[0]).split('\n').find((l) => l.includes('Total')) ?? ''}`);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(problems.length ? problems : 'OK: sin errores');
process.exit(problems.length ? 1 : 0);
