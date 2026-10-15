// tenant.ts — de donde sale la instancia (tenant) en las rutas autenticadas.
//
// La sesion de Fi'ze vive DENTRO de una instancia (el registro `session` y el `user` llevan `instance_id`
// y se leen con ese mismo id), y el middleware deja la instancia donde se resolvio en `locals.instanceId`.
// Esa es la unica fuente valida del tenant. El `instance_id` que mande el cliente (query o body) NO elige
// datos: si coincide con el tenant de la sesion se acepta (es redundante), si difiere se rechaza con 403.
//
// Sin `locals.instanceId` (tests unitarios que llaman al handler directo) se usa la instancia del
// despliegue, igual que el middleware.

import { domainConfig } from '../domain.config';
import { AuthError } from './session';

type LocalsLike = Record<string, unknown> | App.Locals | undefined;

/** Instancia a la que pertenece la sesion actual (o la del despliegue si no hay middleware delante). */
export function tenantOf(locals: LocalsLike): string {
  const fromSession = (locals as { instanceId?: unknown } | undefined)?.instanceId;
  if (typeof fromSession === 'string' && fromSession) return fromSession;
  return domainConfig.instanceId ?? 'default';
}

/**
 * Tenant de la peticion. Lanza AuthError(403) si el cliente pide otra instancia por `?instance_id=` o por
 * `instance_id` en el body. Devuelve siempre el tenant de la sesion, nunca el valor del cliente.
 */
export function resolveTenant(locals: LocalsLike, request: Request, bodyInstanceId?: string | null): string {
  const tenant = tenantOf(locals);
  let queryInstance: string | null = null;
  try {
    queryInstance = new URL(request.url).searchParams.get('instance_id');
  } catch {
    queryInstance = null;
  }
  for (const requested of [queryInstance, bodyInstanceId]) {
    if (requested !== null && requested !== undefined && requested !== tenant) {
      throw new AuthError('instance_id does not match your session', 403);
    }
  }
  return tenant;
}

/** Respuesta JSON para un AuthError (401 o 403); null si el error es otra cosa. */
export function authErrorResponse(err: unknown): Response | null {
  const status = err && typeof err === 'object' ? (err as { status?: number }).status : undefined;
  if (err instanceof AuthError || status === 401 || status === 403) {
    const s = status === 403 ? 403 : 401;
    return new Response(
      JSON.stringify({ error: (err as { message?: string }).message ?? 'Authentication required' }),
      { status: s, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return null;
}
