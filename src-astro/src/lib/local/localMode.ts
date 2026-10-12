// localMode.ts — deteccion del modo local (docs/producto/NODO-LOCAL.md §2.1–2.2).
//
// El modo local son las paginas estaticas bajo `/local/`: el dueno trabaja sin cuenta y los datos viven en
// IndexedDB. Este modulo es diminuto a proposito: `api-client.ts` lo importa en todas las islas del panel y
// no debe arrastrar los handlers ni la criptografia (eso se carga con import() solo en modo local).
import type { SessionUser } from '../auth/session';

export const LOCAL_BASE = '/local/';

/** Origen publico donde viven las cartas publicadas (Decision 1: el modo local vive en este mismo origen). */
export const PUBLIC_ORIGIN = 'https://fize.swal.network';

/** Dueno del nodo local: no hay cuentas, quien abre el equipo es el dueno (el PIN por persona llega en el tramo 2). */
export const LOCAL_OWNER: SessionUser = {
  id: 'local-owner',
  email: '',
  name: 'Dueño del local',
  role: 'owner',
};

export function isLocalPath(pathname: string): boolean {
  return pathname === '/local' || pathname.startsWith(LOCAL_BASE);
}

/** True si la pagina actual es del modo local. En SSR/tests sin `location` es false. */
export function isLocalMode(): boolean {
  return typeof location !== 'undefined' && isLocalPath(location.pathname);
}

let instanceId: string | null = null;

/** La fija `identity.ts` al cargar o crear la llave del restaurante. */
export function setLocalInstanceId(id: string | null): void {
  instanceId = id;
}

/** `local-<10 base32>` si la identidad ya se cargo en esta pagina; null si aun no. */
export function getCachedLocalInstanceId(): string | null {
  return instanceId;
}

/** Enlace publico de la carta, con mesa opcional (`?mesa=N`, lo lee la carta publica). */
export function publicMenuUrl(slug: string, mesa?: number): string {
  const base = `${PUBLIC_ORIGIN}/${encodeURIComponent(slug)}/menu`;
  return mesa ? `${base}?mesa=${mesa}` : base;
}
