import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('local onboarding reaches "Paso 4 de 6"', async ({ app, screen }) => {
  await app.open('/local/');
  await screen.getByRole('button', { name: 'Empezar' }).tap();
  await screen.getByRole('button', { name: 'Siguiente' }).tap();

  await screen.getByLabel('Nombre del negocio').fill('Doña Rosa');
  await screen.getByLabel('WhatsApp para pedidos').fill('300 123 4567');
  await screen.getByLabel('Dirección').fill('Cra 15 # 85-20, Bogotá');
  await screen.getByRole('button', { name: 'Siguiente' }).tap();

  await expect(screen.getByText('Paso 4 de 6')).toBeVisible();
});
