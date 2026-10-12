// meshNs.ts — namespaces mesh canónicos SWAL.
// Replica las REGLAS de @iberi22/edge-mesh (src/namespaces/index.ts:
// swalNamespace/parseSwalNamespace/namespacesAreIsolated) sin importar el
// paquete: su index arrastra PQC + node:crypto + ethers + ws y rompería el
// bundle browser del PWA. Si edge-mesh publica un subpath ligero, migrar a él.
// Tests espejan los casos del core (conformidad).

export function meshNamespace(appId: string, instanceId: string): string {
  const app = appId.trim();
  const instance = instanceId.trim();
  if (!app || !instance) {
    throw new Error('meshNamespace requires non-empty appId and instanceId');
  }
  if (app.includes('/') || instance.includes('/')) {
    throw new Error("meshNamespace segments must not contain '/'");
  }
  return `swal/${app}/${instance}`;
}

export function parseMeshNamespace(ns: string): { appId: string; instanceId: string } | null {
  const parts = ns.split('/');
  if (parts.length !== 3 || parts[0] !== 'swal' || !parts[1] || !parts[2]) {
    return null;
  }
  return { appId: parts[1], instanceId: parts[2] };
}

export function namespacesAreIsolated(a: string, b: string): boolean {
  if (a === b) return false;
  const pa = parseMeshNamespace(a);
  const pb = parseMeshNamespace(b);
  if (pa && pb) {
    return pa.appId !== pb.appId || pa.instanceId !== pb.instanceId;
  }
  return a !== b;
}
