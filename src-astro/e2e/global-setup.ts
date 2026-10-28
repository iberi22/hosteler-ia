// Aplica TODAS las migraciones (001..005) a la D1 local de miniflare antes de la suite.
//
// Sin esto, sobre un estado local nuevo (.wrangler/state borrado, CI) solo existia lo que cada spec creaba
// a mano (004) o lo que el Worker crea solo (sealed_meta): faltaba `auth_rate_limit` (005), el login fallaba
// y todos los specs con sesion de staff caian con "registration closed ... 409".
// Las migraciones son idempotentes (003 ya no hace ALTER), asi que correrlo sobre un estado viejo no rompe.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { request } from '@playwright/test';

export default async function globalSetup(): Promise<void> {
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'SWAL_D1', '--local', '--config', 'wrangler.e2e.jsonc'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'pipe',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });

  // Seed demo data and save storage state for parameterized routes / a11y testing
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const env = {
    ...process.env,
    BASE: 'http://localhost:4331',
    DEMO_EMAIL: 'e2e-owner@fize.test',
    DEMO_PASSWORD: 'e2e-Password-123',
    DEMO_NAME: 'E2E Owner'
  };

  // Ejecutamos seed-demo
  execFileSync('node', ['scripts/seed-demo.mjs'], {
    cwd,
    stdio: 'pipe',
    env
  });

  // Guardar session state para los tests de a11y y rutas autenticadas
  const ctx = await request.newContext({ baseURL: 'http://localhost:4331' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'e2e-owner@fize.test', password: 'e2e-Password-123' },
  });
  if (login.ok()) {
    await ctx.storageState({ path: 'e2e/storageState.json' });
  } else {
    throw new Error('Failed to login during globalSetup');
  }
}
