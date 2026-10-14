import { defineConfig } from 'vitest/config';
import path from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { cloudAlias, CLOUD_DEDUPE, resolveCloud } from './cloud.config.mjs';

const cloud = resolveCloud();
const stubUrl = path.resolve(import.meta.dirname, './src/lib/node-builtins-stub.ts');

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    dedupe: CLOUD_DEDUPE,
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      cloudAlias(),
      ...Object.entries({
      'astro:middleware': path.resolve(import.meta.dirname, './src/lib/astro-middleware-stub.ts'),
      ...Object.fromEntries(
        [
          'node:crypto', 'node:fs', 'node:path', 'node:url',
          'node:http', 'node:child_process', 'node:util',
          'fs', 'path',
        ].map((id) => [id, stubUrl]),
      ),
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.{test,spec}.{ts,js}',
      '../cores/**/*.{test,spec}.{ts,js}',
      ...(cloud.enabled ? ['../private/cloud/src-astro/src/**/*.{test,spec}.{ts,js}'] : []),
    ],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
