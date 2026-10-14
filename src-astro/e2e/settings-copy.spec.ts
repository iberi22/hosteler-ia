import { test, expect } from '@playwright/test';
import { staffCookie } from './staff-auth';

// Staff-facing copy: no development wave labels and no plan/subscription text on the settings page.
test('settings page shows no dev wave badge or plan copy', async ({ request }) => {
  const cookie = await staffCookie(request);
  const res = await request.get('/dashboard/settings', { headers: { cookie } });
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('Configuración del Restaurante');
  expect(body).not.toMatch(/WAVE-/);
  expect(body).not.toMatch(/suscripci/i);
});
