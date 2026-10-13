import { test, expect } from '@playwright/test';

// QA pre-entrega 2026-10-13 #4: en `/local/mesas` el QR de cada mesa resolvia al equipo del duenno
// (`http://localhost:PUERTO/table/<uuid>`), que en el celular del comensal no abre la carta.
//
// Aqui se cubre el caso SIN publicar: el dialogo manda a Publicar y no inventa un enlace.
// El caso publicado (el QR es `https://fize.swal.network/<slug>/menu?mesa=N`) lo cubre
// `e2e/local-to-public.spec.ts`, que publica de verdad contra el Worker local.
test('QR por mesa sin publicar: manda a Publicar y nunca al equipo del duenno', async ({ page }) => {
  // Onboarding hasta el paso 3: con el local creado, /local/mesas ya funciona.
  await page.goto('/local/');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del negocio').fill('Doña Rosa');
  await expect(page.getByLabel('Enlace de tu carta')).toHaveValue('dona-rosa');
  await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await page.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');

  await page.goto('/local/mesas/');
  await page.getByPlaceholder('Nº de Mesa').fill('1');
  await page.getByPlaceholder('Capacidad (pax)').fill('4');
  await page.getByRole('button', { name: 'Añadir Mesa' }).click();
  await expect(page.getByText('Mesa 1')).toBeVisible();

  await page.locator('.table-card').first().click();
  const modal = page.getByRole('dialog', { name: 'Mesa 1 — QR' });
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Tu carta todavía no está publicada.')).toBeVisible();
  await expect(modal.getByRole('link', { name: 'Ir a Publicar' })).toHaveAttribute('href', '/local/publicar/');
  // El QR del equipo no asoma por ningun lado: ni `/table/<uuid>` ni localhost.
  await expect(modal.getByText('/table/')).toHaveCount(0);
  await expect(modal.getByText(/localhost|127\.0\.0\.1/)).toHaveCount(0);
});
