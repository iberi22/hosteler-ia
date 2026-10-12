// cloud/index.ts — frontera del modulo cloud (lado servidor).
//
// `@fize/cloud-impl/*` lo resuelve el build (cloud.config.mjs):
//   - por defecto -> src/cloud/local/*  (sin nube: todo deshabilitado)
//   - con private/cloud presente (o FIZE_CLOUD=1) -> private/cloud/src-astro/src/cloud/*
// Las islas del navegador importan `./client` (no este archivo) para no arrastrar handlers del Worker.
import type { APIRoute } from 'astro';
import { cloudServer } from '@fize/cloud-impl/server';
import type { CloudMethod, CloudRouteId, CloudServer } from './types';

export type * from './types';
export { CLOUD_ROUTE_IDS } from './types';

export const cloud: CloudServer = cloudServer;

/** Respuesta de una ruta cloud cuando el modulo no esta (o no implementa ese metodo). */
export function cloudDisabled(route: CloudRouteId): Response {
  return new Response(JSON.stringify({ error: 'cloud disabled', route }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handler delegador para un archivo de src/pages/api: llama al handler real del modulo cloud, o
 * responde 404 "cloud disabled". `impl` se puede inyectar en tests.
 */
export function cloudRoute(route: CloudRouteId, method: CloudMethod, impl: CloudServer = cloud): APIRoute {
  return (context) => {
    const handler = impl.enabled ? impl.routes[route]?.[method] : undefined;
    return handler ? handler(context) : cloudDisabled(route);
  };
}
