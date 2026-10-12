// types.ts — contrato del modulo cloud de Fize (facturacion, creditos de IA, consumo y facturas SaaS).
//
// Fize es local-first: todo lo que el restaurante necesita para operar (carta, platos, pedidos, cocina,
// inventario, registro manual de cobros) funciona sin internet y sin backend. Lo que mueve dinero real o
// depende de un servicio pagado (planes, creditos de IA, consumo, facturas SaaS, pasarelas) vive en un
// modulo aparte que la app carga SOLO si existe:
//
//   - sin el modulo (repo publico, AGPL): `src/cloud/local/*` — nada habilitado, las rutas responden 404
//     `{ error: 'cloud disabled' }` y la UI esconde lo que dependa de la nube.
//   - con el modulo (`private/cloud/src-astro/src/cloud/*`): la implementacion real.
//
// La eleccion es de build: ver `src-astro/cloud.config.mjs` (alias `@fize/cloud-impl/*`, variable FIZE_CLOUD).
// Este archivo es el unico contrato entre los dos lados: si cambia, cambian los dos.
import type { APIRoute } from 'astro';
import type { Component } from 'svelte';

/** Rutas de API que solo existen con el modulo cloud. Cada una tiene su archivo delegador en src/pages/api. */
export const CLOUD_ROUTE_IDS = ['saas.usage', 'saas.invoices', 'ai.infer'] as const;
export type CloudRouteId = (typeof CLOUD_ROUTE_IDS)[number];

export type CloudMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type CloudRouteModule = Partial<Record<CloudMethod, APIRoute>>;

/** Lado servidor (Worker): handlers de las rutas cloud. */
export interface CloudServer {
  readonly enabled: boolean;
  readonly routes: Partial<Record<CloudRouteId, CloudRouteModule>>;
}

export type TierId = 'free' | 'socio' | 'socio-managed';

export interface CreditLedger {
  used: number;
  limit: number;
  remaining: number;
}

export interface InferResult {
  text: string;
  tokensUsed: number;
  cost: number;
}

/** Creditos de IA y plan del socio. */
export interface CloudBilling {
  creditStatus(used: number, tierId?: TierId): CreditLedger;
  canAffordInference(estimatedTokens: number, used: number, tierId?: TierId): boolean;
  /** Inferencia remota con cobro por creditos. `null` = no se pudo (sin credito o sin red): usar el fallback local. */
  infer(
    prompt: string,
    opts?: { tierId?: TierId; mode?: string; estimatedTokens?: number },
  ): Promise<InferResult | null>;
}

/** Plan contratado del socio (ajustes). */
export interface CloudPlan {
  Panel: Component<{ userEmail: string }>;
}

/** Consumo del periodo y facturas (ajustes). Lee /api/saas/usage y /api/saas/invoices. */
export interface CloudUsage {
  Panel: Component;
}

/** Lado navegador (islas). Cada capacidad es `null` cuando el modulo no esta. */
export interface CloudClient {
  readonly enabled: boolean;
  readonly billing: CloudBilling | null;
  readonly plan: CloudPlan | null;
  /** Consumo + facturas. */
  readonly usage: CloudUsage | null;
}
