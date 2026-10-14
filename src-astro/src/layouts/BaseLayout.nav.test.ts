import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The staff navigation is declared inline in BaseLayout.astro. Every href must point to a
// page that exists, so a renamed or removed page cannot leave a dead link in the menu.
const layout = readFileSync(join(__dirname, 'BaseLayout.astro'), 'utf8');
const navBlock = layout.slice(layout.indexOf('const NAV = ['), layout.indexOf('];', layout.indexOf('const NAV = [')));
const hrefs = [...navBlock.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);

describe('BaseLayout NAV', () => {
  it('declares the staff menu entries', () => {
    expect(hrefs.length).toBeGreaterThanOrEqual(7);
  });

  it.each(hrefs)('href %s points to an existing page', (href) => {
    const base = join(__dirname, '..', 'pages');
    const candidates = href === '/'
      ? [join(base, 'index.astro')]
      : [join(base, `${href.replace(/^\//, '')}.astro`), join(base, href.replace(/^\//, ''), 'index.astro')];
    expect(candidates.some((c) => existsSync(c))).toBe(true);
  });
});
