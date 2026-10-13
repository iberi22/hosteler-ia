import { defineConfig, devices } from '@playwright/test';
import { resolveChromiumExecutablePath } from './scripts/resolve-chromium';

const executablePath = resolveChromiumExecutablePath();

export default defineConfig({
  testDir: './e2e',
  // D1 local con 001..005 aplicadas antes de cualquier spec (e2e/global-setup.ts).
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:4331',
    trace: 'off',
    // On NixOS the Playwright-managed browser cannot resolve libnspr4.so and
    // dies with a misleading "Target page, context or browser has been closed".
    // The /nix/store chromium wrapper runs correctly. This is undefined when
    // Playwright's own browser works (normal Linux/CI/macOS), so it is a no-op
    // there. Force a specific binary with PLAYWRIGHT_CHROMIUM_PATH.
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Un worker: la suite comparte D1 y el mismo navegador, y en paralelo los
  // specs se pisan entre si ("Request context disposed", "frame was detached",
  // timeouts de page.goto). Medido: 7 fallos en paralelo contra 0 en serie.
  // Si esto se pone en paralelo, primero hay que aislar los datos por test.
  workers: 1,
  // Un reintento: los fallos de red local (el server de preview warming up) no
  // son fallos del producto y no deben concluir en rojo una suite verde.
  retries: process.env.CI ? 1 : 0,
  webServer: {
    // Puerto dedicado de Fi'ze: 4321 lo ocupa gara-g (dev) y reuseExisting
    // testeaba LA APP EQUIVOCADA en silencio. false = falla ruidoso si hay ocupacion.
    // Astro 7 detecta shells de agente y manda preview a segundo plano; Playwright necesita un proceso en primer plano.
    command: 'pnpm exec astro preview --port 4331 --ignore-lock',
    url: 'http://localhost:4331',
    reuseExistingServer: false,
    timeout: 120 * 1000,
    // `astro preview` sirve dist/. Sin este build antes, la suite corre contra
    // el bundle de la ultima build: en desarrollo eso es codigo viejo y los
    // fallos apuntan al producto cuando el bug esta en que no recompilaste.
    // Medido: client-journey fallaba con 401 porque dist/ era anterior al fix.
  },
});