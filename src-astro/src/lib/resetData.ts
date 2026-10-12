// reset-data.ts — que se puede borrar con un reset, y quien puede pedirlo.
//
// El legacy (legacy/app/api/reset-data/route.ts) NO borraba nada: era un stub
// que contestaba `{ success: true }` y decia en el mensaje que el cliente
// llamara `resetDB()` desde la consola, porque Dexie vive en el navegador. Es
// decir: no existia ningun reset en el servidor.
//
// Si se portara ese handler tal cual a la arquitectura actual, el resultado
// seria un endpoint que dice "datos reseteados" sin haber reseteado nada —
// exactamente el fallo de honestidad que el repo ya denies en otros sitios
// (breb-honesty.test.ts). Asi que el reset de verdad se hace aqui, en el
// servidor, con las EntityRegistry de domain.config como fuente de verdad.
//
// Reglas de seguridad, en este orden:
//
//  1. Sin sesion -> 401. Sin esto, cualquiera que alcanzara la URL borraria el
//     local entero. La proteccion de ruta (middlewareGating) tambien lo denies
//     por defecto, pero el handler se defiende solo igual: los dos.
//
//  2. Solo `owner`. Un `staff` puede cobrar y crear pedidos; no puede borrar el
//     historial del negocio. El rol sale de la sesion (`locals.user.role`), que
//     el registro de auth asigna solo al primer usuario del instance.
//
//  3. Conteo explicito en el body. Sin `confirm`, el handler NO borra: responde
//     200 con lo que habria que borrar. Un borrado destructivo no puede pasar por
//     un POST vacio: tiene que haber una intencion explicita.
//
//  4. NUNCA se borran `user` ni `session`. Si se borraran, el propio token que
//     autoriza el reset dejaria de existir a mitad de la peticion y el
//     restaurante se queda sin admins, sin poder entrar al panel para
//     reconfigurarse. Es el peor resultado posible de un "borra todo".
//
//  5. Solo el instance de la sesion. `instance_id` se toma de locals/query, nunca
//     del body: un reset no puede volcar el de otro restaurante.

/**
 * Entidades que un reset de "datos operativos" puede tocar. Deliberadamente
 * fuera de `user` y `session` (regla 4).
 */
export const RESETTABLE_ENTITIES = [
  'order',
  'payment',
  'inventoryTx',
  'inventoryItem',
  'menuItem',
  'category',
  'table',
  'purchase',
  'recipe',
  'supplier',
  'notification',
  'restaurant',
] as const;

export type ResettableEntity = (typeof RESETTABLE_ENTITIES)[number];

/** Nunca se borran, aunque se pidan explicitamente. */
export const PROTECTED_ENTITIES = ['user', 'session'] as const;

export interface ResetPlanRow {
  entity: string;
  /** Filas de ESTE instance. */
  count: number;
}

export interface ResetPlan {
  instanceId: string;
  rows: ResetPlanRow[];
  totalInInstance: number;
}

export interface ResetOutcome extends ResetPlan {
  deleted: number;
  /** Entidades pedidas que no existen en la EntityRegistry: no se adivinan. */
  skipped: string[];
}

/** Normaliza lo que llega en el body a una lista de entidades conocidas. */
export function resolveRequestedEntities(raw: unknown): { known: string[]; unknown: string[] } {
  if (raw === undefined || raw === null) {
    return { known: [...RESETTABLE_ENTITIES], unknown: [] };
  }
  if (!Array.isArray(raw)) return { known: [], unknown: [] };

  const known: string[] = [];
  const unknown: string[] = [];
  for (const entry of raw) {
    const name = typeof entry === 'string' ? entry : '';
    // Proteccion por nombre aunque el cliente las pida una por una: pedir
    // ['user'] no puede ser un camino para borrar los usuarios.
    if ((PROTECTED_ENTITIES as readonly string[]).includes(name)) {
      unknown.push(name);
      continue;
    }
    if ((RESETTABLE_ENTITIES as readonly string[]).includes(name)) {
      known.push(name);
      continue;
    }
    unknown.push(name);
  }
  return { known: [...new Set(known)], unknown };
}

/**
 * Cuanto se borraria, sin borrar nada.
 *
 * Se cuenta por entidad para que el 200 del dry-run diga "12 pedidos, 3 pagos"
 * y no "todo". El restaurante decide con numeros, no con una palabra.
 */
export async function planReset(
  adapter: {
    list(entity: string, instanceId: string): Promise<Array<{ instance_id: string }>>;
  },
  instanceId: string,
  entities: readonly string[],
): Promise<ResetPlan> {
  const rows: ResetPlanRow[] = [];
  let totalInInstance = 0;

  for (const entity of entities) {
    let all: Array<{ instance_id: string }> = [];
    try {
      all = await adapter.list(entity, instanceId);
    } catch {
      // Una entidad que el adapter no soporta (p.ej. sin store) no puede hacer
      // fallar el dry-run entero: se reporta en 0 y se sigue.
      all = [];
    }
    // `list` YA viene filtrado por instance_id en los cuatro adapters, asi
    // que el segundo filtro es solo una red por si algun adapter futuro cambia.
    // El "cuantos de otros restaurants NO se tocan" no se puede contar desde
    // aqui: este endpoint solo ve su propio instance, y esa es justamente la
    // garantia que importa.
    const mine = all.filter((r) => r.instance_id === instanceId).length;
    rows.push({ entity, count: mine });
    totalInInstance += mine;
  }

  return { instanceId, rows, totalInInstance };
}

/** El mismo plan, ya ejecutado: borra lo que se pudo y cuenta lo que borro. */
export async function executeReset(
  adapter: {
    list(entity: string, instanceId: string): Promise<Array<{ id: string; instance_id: string }>>;
    del(entity: string, id: string, instanceId: string): Promise<boolean>;
  },
  instanceId: string,
  entities: readonly string[],
  skipped: string[],
): Promise<ResetOutcome> {
  const plan = await planReset(adapter, instanceId, entities);
  let deleted = 0;

  for (const row of plan.rows) {
    if (row.count === 0) continue;
    // Se re-lista en vez de reusar el count: entre el plan y el delete pudo
    // entrar una fila. Se borra lo que exista AHORA, y solo lo del instance.
    const current = await adapter.list(row.entity, instanceId);
    for (const record of current) {
      if (record.instance_id !== instanceId) continue;
      if (await adapter.del(row.entity, record.id, instanceId)) deleted++;
    }
  }

  return { ...plan, deleted, skipped };
}

/**
 * Solo `owner` puede resetear; cualquier otro rol recibe 403.
 *
 * Se exporta separada del endpoint para que la regla se pueda testear sin
 * levantar el handler.
 */
export function canReset(role: string | undefined | null): boolean {
  return role === 'owner';
}

/** Por que no: para que el 403 diga el motivo y no solo el codigo. */
export function resetDenial(role: string | undefined | null): string {
  if (!role) return 'Authentication required';
  if (role !== 'owner') return 'Owner role required to reset data';
  return '';
}