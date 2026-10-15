import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

const isLive = Boolean(process.env.E2E_LIVE_URL);

export default {
  tests: ['e2e-ta/**/*.e2e.ts', '!e2e-ta/findings/**'],
  targets: [
    isLive
      ? {
          name: 'live',
          engine: web(),
          app: {
            url: process.env.E2E_LIVE_URL,
          },
        }
      : {
          name: 'local',
          engine: web(),
          app: {
            url: 'http://127.0.0.1:0',
            command: {
              executable: 'pnpm',
              args: ['exec', 'astro', 'preview', '--host', '127.0.0.1', '--port', '{port}', '--ignore-lock'],
              log: '.e2e/logs/app.log',
              startupTimeout: 120000,
            },
          },
        },
  ],
} satisfies E2EConfig;
