import { test, expect, type Page } from '@playwright/test';

// QA 2026-10-14: en el onboarding del modo local (paso 5, "Tu primera carta") el selector
// de categoría del plato no se podía usar. Este recorrido lo cubre de punta a punta:
// datos del local, código de recuperación, dos categorías, cambio de categoría con el
// <select> y un plato guardado en la categoría elegida.
async function llegarAPasoCarta(page: Page) {
  await page.goto('/local/');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del negocio').fill('Doña Rosa');
  await page.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await page.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('paso')).toHaveText('Paso 4 de 6');
  await page.getByLabel('Ya lo anoté en un lugar seguro').check();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByTestId('paso')).toHaveText('Paso 5 de 6');
  await expect(page.getByRole('heading', { name: 'Tu primera carta' })).toBeVisible();
}

test.describe('onboarding local: carta y plato', () => {
  test('el selector de categoría se puede usar al crear el plato', async ({ page }) => {
    await llegarAPasoCarta(page);

    const categoria = page.locator('#ob-dish-cat');
    // Sin categorías el selector está deshabilitado y el aviso lo dice junto al campo.
    await expect(categoria).toBeDisabled();
    await expect(page.getByText('Crea una categoría arriba para elegirla aquí.')).toBeVisible();

    await page.getByLabel('Nueva categoría').fill('Almuerzos');
    await page.getByRole('button', { name: 'Agregar categoría' }).click();
    await expect(page.getByRole('heading', { name: 'Almuerzos', level: 2 })).toBeVisible();

    // Tras crear la categoría el selector se habilita y queda en la última creada.
    await expect(categoria).toBeEnabled();
    await expect(categoria).toHaveValue(/.+/);
    await expect(categoria.locator('option:checked')).toHaveText('Almuerzos');

    await page.getByLabel('Nueva categoría').fill('Bebidas');
    await page.getByRole('button', { name: 'Agregar categoría' }).click();
    await expect(page.getByRole('heading', { name: 'Bebidas', level: 2 })).toBeVisible();

    // Elegir otra categoría con el selector: debe cambiar la selección real.
    await categoria.selectOption({ label: 'Almuerzos' });
    await expect(categoria.locator('option:checked')).toHaveText('Almuerzos');

    await page.getByLabel('Plato').fill('Ejecutivo del día');
    await page.getByLabel('Precio (COP)').fill('16000');
    await page.getByRole('button', { name: 'Agregar plato' }).click();

    // El plato cae en la categoría elegida, no en la última creada.
    const almuerzos = page.locator('.menu-cat', { has: page.getByRole('heading', { name: 'Almuerzos' }) });
    await expect(almuerzos.getByText('Ejecutivo del día')).toBeVisible();
    // Intl es-CO pone el símbolo y el espacio según el navegador: se compara el número.
    await expect(almuerzos.getByText(/16\.000/)).toBeVisible();
    const bebidas = page.locator('.menu-cat', { has: page.getByRole('heading', { name: 'Bebidas' }) });
    await expect(bebidas.getByText('Ejecutivo del día')).toHaveCount(0);
  });

  test('saltar la carta: el diálogo de artículo explica qué falta y deja elegir categoría', async ({ page }) => {
    await llegarAPasoCarta(page);
    await page.getByRole('button', { name: 'Saltar por ahora' }).click();
    await page.getByRole('button', { name: 'Ir a mi panel' }).click();

    await page.goto('/local/carta/');
    await page.getByRole('button', { name: '+ Nuevo artículo' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Crear artículo de menú' });
    await expect(dialogo).toBeVisible();

    // Sin categorías no hay nada que elegir: el diálogo debe decirlo, no solo mostrar un selector vacío.
    await expect(dialogo.locator('#cat')).toBeDisabled();
    await expect(dialogo.getByText('Crea una categoría antes de agregar un artículo.')).toBeVisible();
    await dialogo.getByRole('button', { name: 'Cerrar' }).click();

    page.once('dialog', (d) => void d.accept('Bebidas'));
    await page.getByRole('button', { name: '+ Nueva categoría' }).click();
    // Se lista en la tabla de categorías (los encabezados de grupo solo salen con artículos).
    await expect(page.getByText('Bebidas', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: '+ Nuevo artículo' }).click();
    const otro = page.getByRole('dialog', { name: 'Crear artículo de menú' });
    await expect(otro.locator('#cat')).toBeEnabled();
    await otro.locator('#cat').selectOption({ label: 'Bebidas' });
    await otro.getByLabel('SKU').fill('BEB-001');
    await otro.getByLabel('Nombre *').fill('Jugo de mango');
    await otro.getByLabel('Precio (COP) *').fill('6000');
    await otro.getByRole('button', { name: 'Guardar' }).click();

    await expect(otro).toHaveCount(0);
    await expect(page.getByText('Jugo de mango')).toBeVisible();
  });
});
