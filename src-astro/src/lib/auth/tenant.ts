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

/**
 * `instance_id` que trae un cuerpo YA parseado, si es una cadena con valor.
 *
 * Zod descarta las claves que no declara, asi que despues de `schema.parse(body)` el `instance_id`
 * del cliente desaparece. Por eso el tenant del cuerpo se lee del objeto crudo, antes de validar.
 */
export function bodyTenant(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = (body as { instance_id?: unknown }).instance_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * `instance_id` del cuerpo de una peticion que todavia no se ha consumido.
 * Clona el request para no robarle el cuerpo al handler. Null si no hay cuerpo, no es JSON o no lo trae.
 */
export async function requestTenant(request: Request): Promise<string | null> {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  try {
    return bodyTenant(await request.clone().json());
  } catch {
    return null;
  }
}

/**
 * Tenant de una ruta autenticada: el de la sesion, rechazando con 403 cualquier `instance_id`
 * distinto que el cliente mande por query o por body (el del body se lee antes de que Zod lo quite).
 * Debe llamarse ANTES de consumir el cuerpo de `request`.
 */
export async function resolveRequestTenant(locals: LocalsLike, request: Request): Promise<string> {
  return resolveTenant(locals, request, await requestTenant(request));
}

/**
 * Tenant de una ruta publica: la instancia del despliegue. El `instance_id` del cliente se IGNORA
 * por completo (ni el query ni el body eligen datos); esta funcion nunca lanza por un valor ajeno.
 */
export function resolvePublicTenant(locals: LocalsLike): string {
  return tenantOf(locals);
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
