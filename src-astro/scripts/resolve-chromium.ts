import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Resolve a Chromium executable for Playwright on NixOS.
 *
 * Why this exists: Playwright's own chrome-headless-shell bundle links against
 * libnspr4.so / libnss3.so / libatk-1.0.so.0, which on NixOS live in the store
 * and are NOT on the loader path. The bundled browser therefore dies at exec
 * time with "error while loading shared libraries: libnspr4.so", which Playwright
 * reports as the very unhelpful "Target page, context or browser has been
 * closed". The chromium in /nix/store is a bash wrapper that pins LD_LIBRARY_PATH,
 * LD_PRELOAD and the suid sandbox, so it runs fine as-is.
 *
 * Resolution order (first hit wins):
 *   1. PLAYWRIGHT_CHROMIUM_PATH / CHROMIUM_PATH — explicit escape hatch.
 *   2. The Playwright-managed browser, but only if its binary actually executes.
 *   3. A /nix/store chromium wrapper.
 *   4. undefined -> let Playwright throw its own launch error, loudly.
 *
 * Step 2 is what keeps this safe: on a normal machine where Playwright's browser
 * works, this resolves to undefined and nothing changes.
 *
 * Everything here is synchronous on purpose: playwright.config.ts must export a
 * single object, so it cannot await anything.
 */

const PROBE_TIMEOUT_MS = 15_000;

let cached: string | undefined | null = null;

/** Does the Playwright-managed browser binary actually start on this machine? */
function bundledBrowserRuns(): boolean {
  let bundled: string;
  try {
    bundled = chromium.executablePath();
  } catch {
    return false;
  }
  if (!existsSync(bundled)) return false;

  const probe = spawnSync(bundled, ['--version'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });

  // Non-zero exit or a loader error on stderr means the binary cannot run here.
  if (probe.error) return false;
  const stderr = probe.stderr ?? '';
  if (/error while loading shared libraries|not found|not found$/.test(stderr)) return false;
  return probe.status === 0 && /Chromium|Chrome|Headless/.test(probe.stdout ?? '');
}

/** Find a /nix/store chromium wrapper, preferring the newest version. */
function findStoreChromium(): string | undefined {
  if (!existsSync('/nix/store')) return undefined;

  let candidates: string[];
  try {
    candidates = readdirSync('/nix/store')
      .filter((entry) => /^[\w.+-]+-chromium-[\d.]+$/.test(entry))
      .map((entry) => `/nix/store/${entry}/bin/chromium`)
      .filter((bin) => existsSync(bin));
  } catch {
    return undefined;
  }
  if (candidates.length === 0) return undefined;

  const versionOf = (bin: string) => {
    const m = bin.match(/-chromium-([\d.]+)\//);
    return m ? m[1].split('.').map(Number) : [0];
  };
  candidates.sort((a, b) => {
    const va = versionOf(a);
    const vb = versionOf(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const diff = (vb[i] ?? 0) - (va[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const chosen = candidates[0];
  // Keep only real bash wrappers: an unwrapped store binary would hit the same
  // missing-libnspr4 problem we are trying to escape.
  if (!/-chromium-[\d.]+\/bin\/chromium$/.test(chosen)) return undefined;

  const probe = spawnSync(chosen, ['--version'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  if (probe.error || probe.status !== 0) return undefined;

  return chosen;
}

export function resolveChromiumExecutablePath(): string | undefined {
  if (cached !== null) return cached;

  const override = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.CHROMIUM_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `PLAYWRIGHT_CHROMIUM_PATH/CHROMIUM_PATH is set to "${override}" but no such file exists.`,
      );
    }
    cached = override;
    return cached;
  }

  if (bundledBrowserRuns()) {
    cached = undefined; // Playwright's own browser works: change nothing.
    return cached;
  }

  cached = findStoreChromium();
  return cached;
}