// Aplica TODAS las migraciones (001..005) a la D1 local de miniflare antes de la suite.
//
// Sin esto, sobre un estado local nuevo (.wrangler/state borrado, CI) solo existia lo que cada spec creaba
// a mano (004) o lo que el Worker crea solo (sealed_meta): faltaba `auth_rate_limit` (005), el login fallaba
// y todos los specs con sesion de staff caian con "registration closed ... 409".
// Las migraciones son idempotentes (003 ya no hace ALTER), asi que correrlo sobre un estado viejo no rompe.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'SWAL_D1', '--local', '--config', 'wrangler.e2e.jsonc'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'pipe',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
}
