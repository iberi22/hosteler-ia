# Mapa de port de cores → hosteler-ia (Fi'ze)

> 2026-09-05 · Estado del port de cada core del ecosistema a esta app.

| Core | Estado | Cómo |
|------|--------|------|
| @swal/ui | ✅ Consumido | Paquete de npm `@swal/ui` ^0.2.0 (ya no vendorizado) |
| @swal/vault | ✅ Consumido | Paquete de npm `@swal/vault` ^0.2.0 (ESM + tipos en dist); usado por `cloudflareVaultAdapter` |
| @iberi22/edge-mesh namespaces | ✅ Reglas porteadas | `src/lib/meshNs.ts` replica `swalNamespace/parse/namespacesAreIsolated` + tests de conformidad; `meshRoom`/`fleetRoom` lo usan |
| @iberi22/edge-mesh transporte | ⏳ Diferido v0.4+ | El index del core arrastra PQC + node:crypto + ethers + ws: rompería el bundle browser. El bus Yjs actual (`mesh.ts`, `yjsFleet.ts`) es equivalente para el uso actual |
| @swal/econ-sdk billing | ⏳ Divergente | El core usa planes storage (free/socio_infra/pro/enterprise); Fi'ze usa tiers AI (free/socio/socio-managed). Unificar requiere decisión de producto |
| @swal/econ-sdk EconEventBus | ⏳ Futuro | Emitir eventos econ (pagos/créditos) al mesh cuando billing salga de localStorage |
| swal-agent-runner | ➖ Referencia | Patrones mesh/crdt citados en comentarios; no portable (runner React + WebContainers) |
| swal-app-template | ✅ Sincronizado | Versiones alineadas al stack verificado de esta app |

## Si edge-mesh publica un subpath ligero

Migrar `meshNs.ts` a `import { swalNamespace } from '@iberi22/edge-mesh/namespaces'`
cuando exista sin deps node/PQC. Criterio: `astro check` + `build` + peso del
chunk cliente sin regresión.
