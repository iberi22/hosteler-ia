import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

const liveUrl = process.env.E2E_LIVE_URL;

if (!liveUrl) {
  throw new Error(
    'e2e.live.config.ts requires E2E_LIVE_URL to be set (for example: ' +
      'E2E_LIVE_URL=https://fize.swal.network e2e run --config e2e.live.config.ts). ' +
      'This config never falls back to a default host, so the read-only smoke suite ' +
      'can only run against an explicitly named deployment.',
  );
}

export default {
  // Read-only suite only: this config can select nothing else.
  tests: ['e2e-ta/smoke.e2e.ts'],
  targets: [
    {
      name: 'live',
      engine: web(),
      app: {
        url: liveUrl,
      },
    },
  ],
} satisfies E2EConfig;
