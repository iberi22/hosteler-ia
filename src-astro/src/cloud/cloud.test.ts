import { describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { cloudDisabled, cloudRoute, CLOUD_ROUTE_IDS } from './index';
import { cloudServer as localServer } from './local/server';
import { cloudClient as localClient } from './local/client';
import type { CloudServer } from './types';

const ctx = {} as APIContext;

describe('modulo cloud: implementacion local (sin nube)', () => {
  it('no habilita nada', () => {
    expect(localServer.enabled).toBe(false);
    expect(localServer.routes).toEqual({});
    expect(localClient).toEqual({ enabled: false, billing: null, plan: null, usage: null });
  });

  it.each(CLOUD_ROUTE_IDS)('la ruta %s responde 404 "cloud disabled"', async (route) => {
    const res = await cloudRoute(route, 'GET', localServer)(ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'cloud disabled', route });
  });
});

describe('modulo cloud: delegacion', () => {
  const fake: CloudServer = {
    enabled: true,
    routes: { 'saas.usage': { GET: () => new Response('ok', { status: 200 }) } },
  };

  it('llama al handler real cuando existe', async () => {
    const res = await cloudRoute('saas.usage', 'GET', fake)(ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('un metodo que el modulo no implementa tambien es 404', async () => {
    const res = await cloudRoute('saas.usage', 'POST', fake)(ctx);
    expect(res.status).toBe(404);
  });

  it('enabled=false gana aunque haya handlers', async () => {
    const res = await cloudRoute('saas.usage', 'GET', { ...fake, enabled: false })(ctx);
    expect(res.status).toBe(404);
  });

  it('cloudDisabled es JSON', () => {
    expect(cloudDisabled('ai.infer').headers.get('Content-Type')).toBe('application/json');
  });
});
