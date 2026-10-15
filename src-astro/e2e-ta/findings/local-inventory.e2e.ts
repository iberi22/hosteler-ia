import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('local inventory page /local/inventario renders its heading', async ({ app, screen }) => {
  await app.open('/local/inventario');
  await expect(screen.getByRole('heading', { name: 'Inventario' })).toBeVisible();
});
