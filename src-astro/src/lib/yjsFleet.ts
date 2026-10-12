// yjsFleet.ts — P2P fleet/entidades CRDT via Yjs (04.1 / 03.02)
// Patron: cores/swal-agent-runner/src/services/mesh/crdt-sync.ts
// Room: swal/{appId}/{instanceId} (ver mesh.ts). Y.Doc + y-webrtc + y-indexeddb.

import { domainConfig } from './domain.config';
import { meshNamespace } from './meshNs';
import { resolveSignalingUrls } from './meshNet';

export type FleetRoom = `swal/${string}/${string}`;

export function fleetRoom(instanceId = domainConfig.instanceId as string): FleetRoom {
  return meshNamespace(domainConfig.appId as string, instanceId) as FleetRoom;
}

// Lazy Yjs para no romper SSR (Astro static)
export async function createFleetDoc(room = fleetRoom(), signaling?: string[]) {
  const [{ Doc }, { WebrtcProvider }, { IndexeddbPersistence }] = await Promise.all([
    import('yjs'),
    import('y-webrtc'),
    import('y-indexeddb'),
  ]);

  const doc = new Doc();
  // Sin señalización explícita no se crea el provider: la malla no usa red hasta emparejar.
  const urls = resolveSignalingUrls(signaling);
  const webrtc = urls.length > 0 ? new WebrtcProvider(room, doc, { maxConns: 20, signaling: urls }) : null;
  let indexeddb: any = null;
  try {
    if (typeof indexedDB !== 'undefined') {
      indexeddb = new IndexeddbPersistence(`swal-fleet-${room}`, doc);
      await new Promise<void>((resolve) => {
        indexeddb.on('synced', () => resolve());
        setTimeout(() => resolve(), 1000);
      });
    }
  } catch (e) {
    console.warn('[yjsFleet] indexedDB fallback', e);
  }

  return {
    doc,
    webrtc,
    indexeddb,
    destroy() {
      try { indexeddb?.destroy(); } catch {}
      try { webrtc?.destroy(); } catch {}
    },
  };
}

// Helpers Y.Map por entity (cada entity es un Y.Map<id, record>)
export async function fleetEntityMap(doc: any, entity: string) {
  return doc.getMap(`fleet:${entity}`);
}
