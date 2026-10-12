import { test, expect } from '@playwright/test';
import { buildPairing } from '../src/lib/pairing';
import { domainConfig } from '../src/lib/domain.config';

const APP_ID = domainConfig.appId as string;
const ROOM = `swal/${APP_ID}/default`;
const RELAY = 'ws://192.168.1.50:4444';

test.describe('pairing LAN sin internet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pair');
    await expect(page.getByTestId('pair-root')).toBeVisible();
    // Hidratación Svelte: sin esto el click al tab cae en HTML muerto (flake)
    await expect(page.locator('[data-testid="pair-root"][data-hydrated="1"]')).toBeAttached();
  });

  test('host genera invitación con QR escaneable y código', async ({ page }) => {
    await page.getByTestId('pair-relay').fill(RELAY);
    await page.getByTestId('pair-name').fill('Caja-1');
    await page.getByTestId('pair-issue').click();
    await expect(page.getByTestId('pair-invite')).toBeVisible();
    // QR real: qrcode-generator emite UN path con d largo (el mock usa rects)
    const d = await page.getByTestId('pair-invite').locator('svg path').first().getAttribute('d');
    expect(d?.length ?? 0).toBeGreaterThan(500);
    await expect(page.getByTestId('pair-code')).toContainText('FZ1');
  });

  test('join manual con código válido empareja', async ({ page }) => {
    const b = buildPairing({ relayUrl: RELAY, room: ROOM, now: Date.now() });
    expect(b.manualCode).not.toBeNull();
    await page.getByRole('tab', { name: 'Unir a un nodo' }).click();
    // Ruta determinista: botón explícito (no depende del estado de cámara)
    await page.getByTestId('pair-use-code').click();
    await page.locator('#pair-code').fill(b.manualCode as string);
    await page.getByRole('button', { name: 'Unir' }).click();
    await expect(page.getByTestId('pair-paired')).toBeVisible();
    await expect(page.getByTestId('pair-paired')).toContainText(`${ROOM}#k=${b.key}`);
  });

  test('join manual con código inválido muestra error', async ({ page }) => {
    await page.getByRole('tab', { name: 'Unir a un nodo' }).click();
    await page.getByTestId('pair-use-code').click();
    await page.locator('#pair-code').fill('FZ1-INVALIDO');
    await page.getByRole('button', { name: 'Unir' }).click();
    await expect(page.getByTestId('pair-error')).toBeVisible();
  });

  test('salir del emparejamiento vuelve a idle', async ({ page }) => {
    const b = buildPairing({ relayUrl: RELAY, room: ROOM, now: Date.now() });
    await page.getByRole('tab', { name: 'Unir a un nodo' }).click();
    await page.getByTestId('pair-use-code').click();
    await page.locator('#pair-code').fill(b.manualCode as string);
    await page.getByRole('button', { name: 'Unir' }).click();
    await expect(page.getByTestId('pair-paired')).toBeVisible();
    await page.getByRole('button', { name: 'Salir del emparejamiento' }).click();
    // idle en tab join → pane join visible, paired oculto
    await expect(page.getByTestId('pair-paired')).toBeHidden();
    await expect(page.getByTestId('pair-join')).toBeVisible();
  });
});
