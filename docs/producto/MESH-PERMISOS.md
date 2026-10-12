# Fize: malla P2P con permisos por módulo

> Estado: **diseño** (2026-10-03). No hay código de esto todavía. Complementa [NODO-LOCAL.md](NODO-LOCAL.md) §2.3–2.4 y
> reemplaza la línea "por la malla viajan cifradas la llave del restaurante y la llave de la malla" de §2.4 (ver §3.1).
> Repos revisados: Fize `develop` (a74d3eb2c), edge-mesh canónico `/home/belal/wt/develop/edge-mesh` `develop` (d1ab64f),
> Shelf `main` (267e44a): `packages/p2p-mesh-core` y la copia `packages/edge-mesh`.

## 0. Resumen

- Hoy **ningún** componente sirve tal cual para "mesera = nodo con permisos": edge-mesh/web cifra y empareja bien, pero
  dentro de la malla **todos los miembros son iguales** (cualquiera revoca, escribe la lista de equipos o borra datos).
- Hay un **fallo real** en la rotación al revocar (H1): un equipo puede registrar un equipo falso antes de ser revocado y
  recuperar la llave nueva por la sala retirada. Se corrige en el core antes de usarlo.
- Shelf tiene permisos por colección, pero sobre un "maestro" elegido por confianza al primer uso, roles guardados en el
  propio CRDT y "aplicar y revertir" por el par que entrega el cambio. Sirven las ideas, no el código.
- Modelo propuesto: la **llave del restaurante = raíz de confianza**, solo en equipos del dueño. Cada equipo tiene su llave
  y recibe un **permiso firmado** (rol + permisos por módulo + vencimiento + cadena de emisores).
- Los datos del negocio viajan como **bitácora firmada por equipo** (cada cambio firmado; cada nodo verifica el permiso
  antes de aplicarlo). Yjs queda para presencia y la lista de equipos.
- La lectura se protege con cifrado real **solo donde vale la pena** (recetas, costos, compras/proveedores, secretos).
  Ventas y caja se ocultan por interfaz: se pueden reconstruir sumando pedidos y hay que decirlo así.
- "No perderla": todos los equipos guardan copia (cifrada donde no tienen permiso). Con **cualquier equipo que sobreviva
  más el código de recuperación** se recupera todo, incluida la llave raíz.
- La lógica genérica (permisos firmados, bitácora, llavero por módulo, recuperación) va al **core edge-mesh**. Fize y Shelf
  solo definen sus módulos, roles y reglas de negocio.
- Primer tramo usable (dueño + mesero/cocina, carta + pedidos): T0+T1+T2, unas 3 semanas con dos frentes en paralelo.

## 1. Diagnóstico

### 1.1 Qué da hoy `@iberi22/edge-mesh/web` (canónico, `src/web/*`)

| Capacidad | Dónde | Estado real | Pruebas |
|---|---|---|---|
| Transporte | `webrtc.ts` (señalización + DataChannel), `transports/{ws,qr-sdp,loopback}.ts` | Funciona en pruebas con loopback en memoria. `iceServers` por defecto `[]` (`webrtc.ts:109`): solo candidatos locales, es decir **misma red** | Sin pruebas con navegador ni WebRTC real |
| CRDT | `provider.ts`: un `Y.Doc` por tema, intercambio de vector de estado + updates | Un solo documento con todo; sin particiones ni réplica parcial | `mesh.test.ts` (convergencia) |
| Cifrado en la red | `crypto.ts`: AES-256-GCM, subllave por emisor, nonce prefijo+contador | Sólido para quien está **fuera** de la malla. Dentro, cualquiera deriva la subllave de cualquiera: **no autentica al emisor** (documentado) | `rooms-crypto`, `rotation` |
| Emparejamiento | `pairing.ts`: QR v2 firmado, secreto de un solo uso, ECDH efímero, SAS | Bien hecho. SAS de **4 dígitos** (`pairing.ts:103`); el "grant" entrega **la llave de la malla + el documento entero** (`provider.ts:519`) | `mesh.test.ts` (SAS, un solo uso, expiración) |
| Revocación | `provider.ts:469` + `rotation.ts`: época nueva, wraps ECDH por pares | Corta al revocado conectado y pone al día a los que estaban fuera de línea. Ver fallos H1–H3 | `rotation.test.ts` (4 casos) |
| Señalización | `workers/signaling` (Worker + DO `MeshRoom`, hibernación, sin almacenamiento) | Relevo puro, 16 KB/mensaje, sala `p_` para emparejar. **Sin desplegar**. Las salas normales exigen JWT `tier:"paid"` (`jwt.ts:47`) | 10 pruebas con `vitest-pool-workers` |
| Persistencia | `y-indexeddb` opcional (`persist:"idb"`) | Funciona; el historial crece sin compactar | Sin prueba propia |
| Permisos | `src/authz/index.ts` (lado Node, no `/web`) | Concesiones locales en memoria/almacén; el campo `firma` se guarda pero **nunca se verifica** (`authz/index.ts:167`) | `tests/authz` (lógica local) |

### 1.2 Qué usa Fize hoy

| Pieza | Archivo | Estado |
|---|---|---|
| Identidad del local | `src-astro/src/lib/local/identity.ts` | ECDSA P-256 exportable en `fize-local`; `instance_id = local-<fp>`. Sirve como raíz |
| Copias | `local/backupCrypto.ts` | Código de 80 bits, PBKDF2 600k; la copia lleva la llave privada del restaurante |
| API local | `local/localApi.ts` | Mismos handlers que en la nube. `LOCAL_OWNER` fijo: **sin roles** |
| Roles en la nube | `lib/auth/session.ts` → `requireSession` | Solo comprueba la sesión. **Ninguna ruta mira `role`** (ALCANCE §4) |
| Malla antigua | `lib/{mesh,yjsFleet,fleetStore,pairing,meshNet}.ts`, `pages/pair.astro` | y-webrtc. La "clave" va en el nombre de la sala (`pairing.ts:207`, `#k=`): el relevo la ve. Sin E2E de aplicación ni autorización. Apagada sin señalización |
| edge-mesh | — | Fize **no depende** de `@iberi22/edge-mesh` (solo replica reglas en `meshNs.ts`) |
| Piezas que sirven | `orderStateMachine.ts`, `inventoryLedger.ts` | Máquina de estados de pedidos y libro de movimientos: encajan con una bitácora de eventos |

### 1.3 Hallazgos que afectan este diseño

| # | Hallazgo | Evidencia | Grav. |
|---|---|---|---|
| H1 | **Fuga de la llave rotada.** `meta` (lista de equipos) es un `Y.Map` que cualquier miembro escribe. Antes de ser revocado, un equipo crea `dev/falso` con su propia llave y firma `ecdh/falso`. Al revocar, `revoke()` hace un wrap para cada `devices()` (`provider.ts:481`), también para `falso`. El atacante pide ese wrap en la sala retirada con `deviceId=falso` y obtiene la llave nueva | `provider.ts:142,481`; `peerEcdhPub` verifica contra `dev/<id>.pub`, que controla el atacante | Alta |
| H2 | Cualquier miembro puede revocar a cualquiera, **incluido el dueño**, y forzar una rotación. `handleRotate` acepta a cualquier emisor no revocado | `provider.ts:295,469` | Alta |
| H3 | Los datos no tienen autorización: cualquier miembro aplica cualquier update de Yjs (borrar la carta, cambiar precios) | `provider.ts` `K_UPDATE` → `Y.applyUpdate` | Alta para roles |
| H4 | `revokedIds` vive en memoria (`provider.ts:121`). La confidencialidad se mantiene por la época, pero el rechazo explícito se pierde al recargar | | Baja |
| H5 | Sin fragmentación: el emparejamiento envía el documento entero en un solo mensaje. Los DataChannel de los navegadores limitan el tamaño (Chrome ~256 KB; verificar). Un local con meses de pedidos no cabe | `provider.ts:519` | Media |
| H6 | Remoto (mesera en datos móviles) no conecta: sin STUN ni TURN | `webrtc.ts:109` | Media |
| H7 | La señalización exige plan pago; el modo local gratis no tiene cómo entrar | `workers/signaling/src/jwt.ts:47` | Media |
| H8 | NODO-LOCAL §2.4 planeaba enviar la llave del restaurante a todo equipo emparejado: la mesera quedaría con la raíz | `NODO-LOCAL.md` §2.4 | Alta (de diseño) |
| H9 | `cores/edge-mesh` (checkout `main`, a11797c) **no tiene `src/web`**; lo canónico está en `develop` (x4/x5) | `git rev-parse` en ambos | Info |

### 1.4 Pruebas ejecutadas (2026-10-03)

| Repo | Comando | Resultado |
|---|---|---|
| edge-mesh `develop` | `npx vitest run tests/web tests/authz tests/op-log tests/sync` | 11 archivos, **75/75** pasan |
| edge-mesh `workers/signaling` | `npx vitest run` | **10/10** pasan |
| edge-mesh | `npx tsc --noEmit` | exit 0 |
| Fize `develop` | `npx vitest run src/lib/local src/lib/{mesh,meshNet,meshNs,pairing,publicMenuSignature,orderStateMachine,inventoryLedger,idbSync}.test.ts src/lib/auth` | 17 archivos, **90/90** pasan |
| Shelf `p2p-mesh-core` | `npx vitest run` en el repo | 7/9 archivos fallan: **no hay `node_modules`** (yjs, `@noble/post-quantum`) |
| Shelf `p2p-mesh-core` | copia en el scratchpad con los `node_modules` de edge-mesh (`@noble/post-quantum` 0.6.1, Shelf declara ^0.7) | 9 archivos, **96/96** pasan |

No hay pruebas Playwright de edge-mesh/web con dos navegadores reales. `e2e/pairing.spec.ts` de Fize prueba el pairing antiguo.
Xavier (`/v1/memories/search`) devolvió una respuesta vacía; no hubo contexto previo.

## 2. Qué ya existe (edge-mesh canónico vs Shelf p2p-mesh-core vs copia de Shelf)

La copia de Shelf (`apps/shelf/packages/edge-mesh`, "edge-mesh" 0.0.1) es una **bifurcación**. Es más vieja que la
canónica: no tiene `web/`, `adapters/`, `gos/`, `node-memory/` ni `governance/authority.ts`, y su `authz` tiene 200
líneas contra 407. Tiene un endurecimiento propio (294ce2d, 2026-08-27): `requireSignedEnvelopes` **activo por defecto**
(`config.requireSignedEnvelopes !== false`); en la canónica está **apagado por defecto** (`=== true`, `edge-mesh.ts:340`).
`authz` existe en las dos y en ninguna se verifica la firma de las concesiones.

| Capacidad | Canónico (`wt/develop/edge-mesh`) | Shelf `p2p-mesh-core` | Copia de Shelf | Veredicto |
|---|---|---|---|---|
| Roles y permisos | `authz/`: concesiones por espacio, roles; firma no verificada, solo Node | `authority-checks.ts`: matriz `canView*/canEdit*` por colección; roles `admin/collaborator/vendedor/custom/readonly`; permisos guardados en `linkedNodes` **dentro del CRDT** | `authz/` más viejo | **Adaptar**: la forma de la matriz (módulo × ver/editar) y `canInvite` → `delegar`. **Descartar** guardar roles como datos del CRDT sin firma de un emisor |
| Autoridad / escritura firmada | `edge-mesh.ts` (Node) firma sobres ML-DSA; `/web` sin firma de autor | `yjs-sync.ts`: firma ML-DSA del **update entero por el par que lo entrega** (exige firmante = conexión). El `timestamp` **no** entra en la firma (`createCrdtEnvelope` firma solo `update`), así que la frescura se puede falsificar. El autor real se pierde al reenviar | Igual que canónico, firma activa por defecto | **Descartar** el esquema por salto. **Reusar** la idea del registro de rechazos (`crdtEnvelopeAuditLog`) como "cuarentena" |
| Maestro / consenso | `governance/` (elección, votos) | Maestro = primer par verificado con un "admin claim" **firmado por su propia llave** sobre `shelf:admin-claim:<id>` (estático, reutilizable): confianza al primer uso. `consensus.ts`: mayoría de pares activos, sensible a pares falsos. Admin sin conexión pasa a `readonly` (SHELF-105) | Similar | **Descartar** en Fize: la autoridad sale de la llave del dueño, no de votos ni del primero en llegar. Bajar a solo lectura sin conexión contradice "offline-first" |
| Merge / conflictos | Yjs LWW por clave | `merge-engine.ts`: aplica, compara snapshot JSON de **todas** las colecciones y **revierte** lo no permitido (O(n) por update; la reversión es una escritura nueva que otro par puede ver distinto). `mergeProductFields` + `pendingEdits` (edición vieja de colaborador queda pendiente de aprobación) | — | **Adaptar** `pendingEdits` como operación genérica "propuesta → aprobación". **Descartar** aplicar y revertir |
| Catch-up | Vector de estado Yjs (`K_SV`) | `connection-catchup`: diff por vector de estado al abrir conexión | Igual | **Reusar el concepto** con vectores de versión por equipo (§3.4) |
| Nube | — | `cloud-sync.ts`: sube `encodeStateAsUpdate` **en claro** a Supabase cada 60 s | — | **Descartar**: rompe "SWAL no ve tus datos". En Fize la nube es N2/N3 cifrada |
| Transporte | `/web` (WebRTC + DO + qr-sdp) | PeerJS (`0.peerjs.com` público en prod) + `p2p-transport-adapter.ts` hacia sobres edge-mesh | PeerJS/relay Node | **Canónico `/web`**; descartar PeerJS |
| Pruebas | 75 + 10 pasan | 96 pasan (con dependencias prestadas); `security.test.ts` cubre bien los casos que diseñó | — | Portar como casos de regresión los escenarios de `security.test.ts` (par no verificado, firma inválida, firmante distinto, privilegios) |

## 3. Modelo objetivo

### 3.1 Identidad y confianza

| Elemento | Diseño |
|---|---|
| Raíz | La llave del restaurante actual (`identity.ts`). `instance_id` sigue siendo la huella de la llave **génesis** (no cambia si la raíz rota). Vive **solo** en equipos del dueño |
| Llave del equipo | ECDSA P-256 + ECDH P-256 **no exportables** (`CryptoKey` guardada en IndexedDB), generadas en cada equipo. `deviceId` = huella de la pública. Campo `alg` para pasar a ML-DSA después |
| Permiso (grant) | Documento firmado: "esta llave de equipo tiene este rol en este local" (§3.3). Se replica a todos los nodos |
| Unirse (mesera, cocina, socio) | 1) En "Personal y equipos" el dueño o un admin elige rol, nombre y vencimiento → QR (pairing v2). 2) El celular nuevo lo escanea; los dos muestran el mismo **código SAS de 6 dígitos** y cada persona confirma. 3) El anfitrión firma el permiso con la llave pública que llegó por el canal ya autenticado |
| Qué recibe | Llave de la malla (transporte), su permiso + la cadena hasta la raíz, la pública raíz, las llaves de módulo que puede leer (wrap ECDH a su llave), punto de control firmado. Los datos llegan después por la sincronización normal, en partes, no dentro del emparejamiento |
| Qué NO recibe | La llave raíz, llaves de módulos sin permiso, el código de recuperación |
| Otro equipo del dueño | Es el flujo de recuperación (§3.7): se empareja y el dueño **escribe su código** en el equipo nuevo para abrir el sobre de la raíz. La raíz nunca viaja en claro |

### 3.2 Módulos, acciones y roles

Acciones por módulo: **ver** (V), **editar** (E), **administrar** (A: borrar, anular, configurar, aprobar propuestas).
**Delegar** es aparte y solo existe en "personal y permisos". Los roles son plantillas que el dueño puede editar; el
permiso firmado guarda los permisos ya resueltos, no el nombre del rol.

| Módulo | Dueño | Admin (socio) | Mesero/a | Cocina | Caja | Inventario |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| carta | A | A | V | V | V | V |
| pedidos y mesas | A | A | E | V | E | — |
| cocina (KDS: estado de comanda) | A | A | E (servido) | E | V | — |
| caja y pagos | A | A | — | — | E | — |
| inventario (cantidades) | A | A | — | V | V | E |
| recetas (preparación) | A | A | — | V | — | V |
| costos (costo unitario, márgenes) | A | A | — | — | — | — |
| compras y proveedores | A | A | — | — | — | E |
| analítica y ventas | A | A | — | — | V (día) | — |
| ajustes del local | A | E | — | — | — | — |
| personal y permisos | A + delegar 2 | V + delegar 1 | — | — | — | — |
| publicar carta | A | E | — | — | — | — |
| copias (.fize, nube) | A | E | — | — | — | — |

**Co-admin y profundidad de delegación:** el dueño puede emitir permisos con `delegar ≤ 1`. Un admin con `delegar = 1`
emite permisos con `delegar = 0`, siempre un **subconjunto** de los suyos. Un admin no crea admins ni revoca al dueño ni a
otros admins. Solo el dueño hace sucesión, traspaso y revocación de admins.

### 3.3 Permisos firmados

```jsonc
// fize.grant/v1, JSON canónico (canonicalJson de publicMenuSignature.ts) + firma ECDSA P-256 (alg extensible)
{ "t":"grant", "v":1, "inst":"local-…", "id":"<sha256 del cuerpo>", "sub":"<deviceId>", "subPub":"<jwk>", "subEcdh":"<raw b64u>",
  "name":"Ana (mesera)", "perms":{"pedidos":"E","cocina":"E","carta":"V"}, "delegate":0,
  "nbf":<hlc>, "exp":<ms|null>, "iss":"<deviceId emisor|root>", "parent":"<id del grant del emisor|null>", "sig":"…" }
{ "t":"revoke", "v":1, "inst":"…", "target":"<grant id>", "upTo":{"<deviceId>":<seq>}, "cascade":true, "iss":"…", "parent":"…", "sig":"…" }
{ "t":"succession", "v":1, "inst":"…", "newRoot":"<jwk>", "upTo":{…}, "by":"recovery|root", "sig":"…" }
```

| Regla de verificación (cada nodo, antes de aplicar) | |
|---|---|
| Cadena | `sig` válida con `subPub` del `parent`… hasta la raíz vigente (génesis + sucesiones). Profundidad ≤ 2 |
| Subconjunto | `perms(hijo) ⊆ perms(emisor)` y `delegate(hijo) < delegate(emisor)` |
| Vigencia | `exp` y `nbf` se comparan con el **HLC de la operación**, no con el reloj del receptor. El resultado es determinista (todos deciden igual). El vencimiento es un control blando; el corte duro es revocar |
| Revocación | Una operación del equipo X con `seq > upTo[X]` queda rechazada. Las de `seq ≤ upTo` siguen válidas aunque lleguen tarde. Así no hace falta confiar en relojes |
| Cascada | Revocar un admin invalida los permisos que emitió. La interfaz ofrece **re-anclar** con un toque ("¿Mantener a las 3 personas que agregó Juan?"): el dueño vuelve a firmar esos permisos |
| Orden de llegada | Una operación que llega antes que su permiso queda **pendiente**, no rechazada |

### 3.4 Escritura autorizada: bitácora firmada (no Yjs crudo)

Con Yjs crudo no se puede autorizar por autor: un update mezcla cambios de varios autores, se reenvía y no lleva firma de
quien lo escribió (Shelf lo intentó firmando por salto y revirtiendo después). Propuesta: **cada equipo escribe su propia
cadena de operaciones firmadas**.

```jsonc
{ "dev":"<deviceId>", "seq":42, "prev":"<sha256 op 41>", "hlc":"1730…-0003", "mod":"pedidos", "act":"order.state",
  "ent":"order", "id":"<uuid>", "base":"<ref de la op que vio>", "actor":"pin:ana", "body":{…} | "enc":{"kid":"costos","ep":3,"iv":"…","ct":"…"},
  "sig":"<ECDSA del equipo sobre todo lo anterior>" }
```

| Aspecto | Diseño |
|---|---|
| Sincronizar | Intercambio de **vector de versión** `{deviceId: últimoSeq}` y envío de los rangos que faltan, por el canal cifrado de la malla en mensajes de ≤ 64 KB. Nadie puede borrar ni reescribir operaciones ajenas (firma + cadena `prev`); dos operaciones con el mismo `seq` = **equivocación**: se marca el equipo y se avisa al dueño |
| Validar | firma → cadena de permiso vigente para `(mod, act)` → regla de negocio (máquina de estados, etc.) → proyección. Si falla: **cuarentena** con motivo, visible en "Personal y equipos". No se reenvía |
| Determinismo | La proyección (`fize-db`) es función del conjunto de operaciones y permisos, ordenados por `(hlc, dev, seq)`. Si un permiso o una revocación llegan tarde, se recalcula solo el módulo afectado (`rebuild(mod)`) |
| Compactar | Punto de control firmado por dueño o admin: proyección del módulo + vector de versión. Los equipos de personal guardan desde el último punto y 30 días; dueño y admins guardan todo (archivo mensual a `.fize`) |
| Relojes | HLC. Una operación con `hlc` más de 10 min en el futuro queda pendiente hasta que el reloj la alcance |
| Presencia | Yjs/awareness sigue igual: es solo informativa y no se confía en ella |

**Conflictos por módulo**

| Módulo | Regla |
|---|---|
| carta, mesas, ajustes, recetas, costos, proveedores | **LWW por campo**. Si dos ediciones son concurrentes (misma `base`), gana el rango mayor (dueño > admin > resto) y luego el HLC. Borrar = lápida; una edición concurrente con un borrado pierde, salvo que el dueño restaure. Edición sin permiso de editar pero con "proponer" → `propuesta` que A aprueba (idea de `pendingEdits` de Shelf) |
| pedidos | Eventos sin edición: `order.created`, `item.added`, `item.voided`, `order.state`. El estado sale de `orderStateMachine.ts` aplicado en orden. Una transición inválida (cocina marca "listo" un pedido cancelado) se ignora y se marca "conflicto" en la comanda |
| cocina | Solo `order.state` → `preparing/ready`. El mesero puede marcar `served` |
| caja y pagos | `payment.recorded` / `payment.voided` (A) / `shift.closed`. Un pago que llega después del cierre del turno pasa al turno siguiente con aviso |
| inventario, compras | Movimientos firmados (`inventoryLedger.ts`: purchase/use/waste/adjust). Stock = suma. No hay conflicto; si queda negativo, alerta |
| personal y permisos | No es LWW: los permisos y revocaciones son documentos firmados que solo se agregan (§3.3) |

### 3.5 Lectura: qué se cifra de verdad

Quien guarda una réplica puede leer todo lo que esté en claro en su IndexedDB. Ocultar por interfaz no protege de alguien
que abra las herramientas del navegador. Por eso se usan **llaves de módulo** (AES-256-GCM con época), con wrap ECDH
para cada equipo que tiene "ver" y otro wrap para la llave de recuperación (§3.7). Los equipos sin permiso **guardan y
reenvían el texto cifrado**, así que ayudan a que no se pierda aunque no lo puedan leer.

| Llave | Cubre | Quién la tiene | Por qué |
|---|---|---|---|
| `recetas` | pasos y cantidades de preparación | dueño, admin, cocina, inventario | Las recetas son el secreto del local; el mesero no las necesita |
| `costos` | costo unitario de insumos, márgenes, compras, proveedores (precios y contactos) | dueño, admin (+ inventario si se le da "compras") | Es lo más sensible frente a ex-empleados y competencia |
| `secretos` | ajustes sensibles (código de activación, tokens) | dueño, admin | Evita suplantar al local |
| (ninguna) | carta, pedidos, mesas, cocina, cantidades de inventario, caja, ventas | todos los que trabajan el turno | La carta es pública. **Ventas y caja se pueden reconstruir sumando pedidos**: ocultarlas por interfaz es lo único posible y se dice así en la pantalla de permisos |

### 3.6 Revocación

| Paso | Qué pasa |
|---|---|
| 1 | El dueño (o el admin que lo emitió) firma `revoke` con `upTo` = último `seq` que **su equipo** ya vio del revocado. Si hay cambios del revocado sin sincronizar, la interfaz lo dice antes ("Ana tiene cambios sin enviar; sincroniza antes si los necesitas") |
| 2 | Rotar la llave de la malla (edge-mesh, ya corregido H1/H2) y la **época de cada llave de módulo que el revocado podía leer** |
| 3 | Los nodos dejan de aceptar operaciones del revocado con `seq > upTo` y cierran sus enlaces |
| Lo que conserva el revocado | Todo lo que ya tenía y podía descifrar hasta ese momento. Ninguna técnica lo evita; se dice en la pantalla. No recibe nada nuevo |

### 3.7 Durabilidad y recuperación ("no perderla")

| Pieza | Diseño |
|---|---|
| Réplicas | Todos los equipos guardan todos los módulos (cifrados donde no tienen llave). Dueño y admins guardan historia completa; el personal, desde el último punto de control |
| Sobre de recuperación | En el onboarding se crea la **llave de recuperación R** (P-256). El sobre = AES-GCM(PBKDF2(código, 600k), {raíz privada, R privada}) y se **replica a todos los equipos** como registro firmado. Con 80 bits de código y 600k iteraciones, adivinarlo por fuerza bruta no es viable. La raíz firma `R.pub` en el génesis y cada época de llave de módulo también se envuelve para `R.pub` |
| Dueño pierde el celular | 1) Los admins siguen operando (sus permisos valen). 2) Celular nuevo → **emparejamiento de recuperación** con cualquier equipo (incluso uno de la mesera): recibe la llave de la malla y la réplica cifrada, sin permiso de escritura. Esto no expone más de lo que ese equipo ya tenía. 3) El dueño escribe su código → abre el sobre → tiene raíz y R → descifra todos los módulos. 4) Revoca el equipo perdido (`upTo`) y rota llaves |
| Si el celular perdido pudo quedar en malas manos | **Sucesión**: nueva raíz firmada por R (el ladrón tiene la raíz, pero no el código). Los nodos aceptan `succession` firmada por la R comprometida en el génesis; `upTo` invalida lo que el ladrón firme después. Luego se genera R' y un código nuevo |
| Traspaso (venta del local) | `succession` firmada por la raíz actual hacia la llave del nuevo dueño + código nuevo + revocación de los equipos del dueño anterior. El Worker de publicación acepta la cadena génesis → sucesión para el mismo slug |
| Copias | `.fize` (N1) y nube cifrada (N2) siguen igual y sirven si no sobrevive ningún equipo. Sin código no hay recuperación: SWAL no guarda llave de rescate (NODO-LOCAL Decisión 6) |

### 3.8 Topología y transporte

| Escenario | Cómo | Nota |
|---|---|---|
| Mismo WiFi con internet | Señalización DO (`swal-mesh-signaling`); los datos van directo por la LAN | Caso principal |
| Remoto (mesera en datos móviles, dueño en casa) | DO + STUN `stun.cloudflare.com:3478` | Algunas redes móviles (NAT simétrico) necesitan TURN: solo en pago y opcional. Cloudflare ve las IP, no el contenido |
| Mismo WiFi sin internet | `qr-sdp`: hay que escanear de nuevo al reconectar. Avanzado: relevo LAN en un mini-PC | Se dice en la interfaz |
| Equipos que nunca coinciden en línea | Hoy: `.fize`. Después: buzón cifrado en el DO (T9) | |
| iOS | Sincroniza solo con la app abierta (no hay Background Sync). Reconecta en `visibilitychange`/`online`; las operaciones quedan en cola local | Exigir PWA instalada |
| Admisión a la señalización | El Worker de Fize emite un JWT `tier:"free-local"` (7 días) a un equipo que presente una cadena de permiso válida hasta una raíz **activada** (la misma tabla D1 de publicación, solo lectura). El DO acepta `free-local` con 8 pares por sala y cuota de mensajes | 0 KV, 0 escrituras D1, 1 Worker nuevo, 0 crons |

**Costo estimado de señalización** (local con 4 equipos y 20 aperturas al día cada uno): 80 conexiones (80 peticiones
Worker + 80 DO) + ~640 mensajes (/20 = 32 DO) ≈ **190 peticiones/día por local**. Con 100 locales ≈ 8k peticiones Worker +
11k DO al día, alrededor del 8–11 % del cupo diario de 100k que comparten todos los proyectos (verificar si las
peticiones DO salen del mismo cupo). Con hibernación, una conexión inactiva no cobra duración. Ver tokens: ~4 peticiones
por equipo al mes.

### 3.9 Cambios en Fize

| Pieza | Cambio |
|---|---|
| `local/localDb.ts` | `LocalKey` suma `device` (pares no exportables), `membership` (`{inst, rootPub, grantId}`), `recoveryEnvelope` |
| `lib/mesh/meshDb.ts` (nuevo, IndexedDB `fize-mesh`) | stores `ops` ([dev,seq], índices `mod`, `hlc`), `heads`, `grants`, `revocations`, `keyring`, `checkpoints`, `quarantine`, `pending` |
| `lib/mesh/fizeSchema.ts` (nuevo) | Módulos, acciones, plantillas de rol, tabla **ruta+método → (módulo, acción)**, validadores de negocio y proyecciones (usa `orderStateMachine`, `inventoryLedger`) |
| `lib/mesh/recordingAdapter.ts` (nuevo) | `StorageAdapter` que envuelve `getIdbAdapter()`: cada `create/update/del` de un handler se vuelve una operación firmada (se escribe primero la operación y después la proyección; al arrancar se reaplica lo que falte) |
| `local/localApi.ts` | `LocalContext.grant`; antes del handler `authorize(perm(route, method), grant)` → 403 con mensaje claro; `storage` = adaptador que graba; `/api/auth/me` devuelve rol y permisos |
| Handlers `pages/api/*` | Sin cambios de lógica. `locals.permissions` lo llena el modo local (desde el permiso) o la nube (desde `membership.role`, ALCANCE §6 Fase 1) con **la misma tabla** |
| Interfaz | `can(mod, act)` para ocultar pantallas; `pages/local/personal.astro` (personal y equipos, cuarentena, revocar); PIN por persona en tabletas compartidas (solo interfaz; queda en `actor`) |
| Se retira | `lib/{mesh,yjsFleet,fleetStore,pairing,meshNet}.ts`, `pages/pair.astro` y `y-webrtc` (también baja ~100 KB gzip de la landing, REVISION #22) |

## 4. Plan de port al core

Regla de Bel: un solo core y nada de copias. Todo lo que no nombra un negocio va a **edge-mesh canónico** (`develop`),
es puro de navegador (la prueba `src/web is browser-pure` ya lo exige) y tiene su suite.

| Módulo core (nuevo) | Contenido | Origen |
|---|---|---|
| `web/trust/` → `@iberi22/edge-mesh/web/trust` | Documentos `grant/revoke/succession`, JSON canónico, firma/verificación (`alg`: P-256 hoy, ML-DSA-65 después), cadena con profundidad, `effectivePerms(dev, seq, hlc)`, cascada | Nuevo. Toma de Shelf la forma de la matriz y `canInvite` |
| `web/oplog/` | Bitácora por equipo: `prev`, vector de versión, rangos, equivocación, pendientes, cuarentena con motivo, puntos de control, gancho `validate(op, ctx)` | Nuevo. Toma de Shelf el catch-up y el registro de rechazos. Reemplaza `src/op-log` (Node) a largo plazo |
| `web/keyring.ts` | Llaves por módulo con época, wraps ECDH (generaliza `rotation.ts` `wrapMeshKey` con una etiqueta), wrap para recuperación | Refactor de `rotation.ts` |
| `web/recovery.ts` | Sobre PBKDF2+AES-GCM, compromiso de R en el génesis, sucesión | Mueve la idea de `backupCrypto.ts` de Fize |
| `web/merge.ts` | LWW por campo con `base` + rango, ejecutor de máquina de estados por eventos, libro que suma, propuesta/aprobación | Generaliza `mergeProductFields` y `pendingEdits` de Shelf |
| `web/provider.ts` (cambios) | `authorizeDevice(dev)` (filtra `devices()`, wraps y `onData`: arregla H1/H3), `canRotate(from)` (H2), `revokedIds` persistente (H4), `channel(kind)` para tramas cifradas propias, fragmentación (H5), `pairHost({extra})`/`onGuest`, SAS de 6 dígitos con transcripción (guest y host pub, pairSecret), `iceServers` configurable con STUN de Cloudflare documentado (H6) | Canónico |
| `workers/signaling` | Nivel `free-local` + cuota por sala (H7) | Canónico |
| `edge-mesh.ts` (Node) | Subir de la copia de Shelf `requireSignedEnvelopes` activo por defecto | Copia de Shelf → canónico |

**Esbozo de API**

```ts
const trust = createTrust({ inst, root: rootPubJwk, schema: { modules: ['carta','pedidos',…], actions: ['V','E','A'] } });
await trust.add(doc);                      // grant | revoke | succession: verifica y guarda
trust.can(deviceId, 'pedidos', 'E', { seq, hlc }): boolean;
const log = createOpLog({ mesh, trust, store: idbOpStore('fize-mesh'), validate: fize.validate, project: fize.project });
await log.append({ mod:'pedidos', act:'order.state', ent:'order', id, body });   // firma con la llave del equipo
log.on('applied' | 'quarantined' | 'equivocation', cb);
const keys = createKeyring({ trust, mesh, recoveryPub });  keys.seal('costos', bytes); keys.rotate(['costos'], revokedId);
const mesh = createMesh({ …, authorizeDevice: (d) => trust.isMember(d), canRotate: (d) => trust.can(d, 'personal', 'A') });
```

| Queda en cada app | Fize | Shelf |
|---|---|---|
| Esquema | `fizeSchema.ts`: los 13 módulos de §3.2, plantillas (dueño, admin, mesero, cocina, caja, inventario), ruta → permiso | `shelfSchema.ts`: products, sales, clients, suppliers, purchaseOrders, arqueo…; plantillas admin/collaborator/vendedor/readonly |
| Reglas | `orderStateMachine`, `inventoryLedger`, proyección a `fize-db` | Proyección a sus colecciones; `pendingEdits` pasa a ser "propuesta" del core |
| Interfaz | Personal y equipos, PIN | Su pantalla de equipo |

**Consumo:** edge-mesh publica `./web` y `./web/trust` y se consume **fijado a un commit**, como Nido
(`"@iberi22/edge-mesh": "file:src/lib/vendor/edge-mesh"` con `dist/` + `SOURCE_SHA`) o como dependencia git con SHA
(Decisión 2). Shelf, en su propio plan (T8): borra `packages/edge-mesh`, cambia `p2p-mesh-core` por el core y retira
maestro/consenso/revertir/cloud-sync en claro. Fize nunca copia código del core.

## 5. Modelo de amenazas

| Amenaza | Qué logra hoy | Mitigación en el diseño |
|---|---|---|
| Celular de mesera perdido o robado | Todo el documento, escribir lo que quiera, revocar al dueño | Bloqueo del equipo; el dueño revoca desde cualquier equipo suyo (`upTo` + rotación); el ladrón conserva lo que había (sin recetas ni costos: estaban cifrados para él) |
| Celular del dueño perdido | Raíz expuesta | Sucesión con R (§3.7); los admins siguen operando; recuperación con código |
| Ex-empleado malicioso (antes de irse) | Crear equipos falsos para recibir llaves futuras (H1), borrar la carta | Equipos solo con permiso firmado (`authorizeDevice`); revocación con `upTo`; cambios fuera de su permiso van a cuarentena |
| Equipo comprometido (malware, XSS en el origen) | Todo lo que ese equipo puede leer y firmar | Mismo alcance que su permiso, nada más. CSP estricta en `/local/` (todo el origen comparte IndexedDB); permisos con vencimiento; revocar |
| Reenvío de operaciones viejas (replay) | — | `(dev, seq)` único + cadena `prev`: un duplicado no cambia nada; si el contenido cambia, es equivocación |
| Permisos falsificados | Hoy no hay permisos | Cadena firmada hasta la raíz, subconjunto, profundidad ≤ 2 |
| Escalar privilegios dentro de la cadena | — | Un admin solo emite subconjuntos con `delegar = 0`; no puede tocar al dueño ni a otros admins |
| Operador del relevo (SWAL/Cloudflare) | Ve rid, tamaños, IP y horarios | Rid HMAC, SDP cifrado, datos P2P cifrados; la señalización no guarda nada. Aceptado: metadatos de conexión |
| Tableta compartida | Cualquiera usa el rol del equipo | El permiso es del equipo (rol de puesto: "tableta cocina"). PIN por persona = solo interfaz, queda en `actor`. No se le dan módulos con llave a tabletas compartidas |
| Relojes manipulados | Saltarse vencimientos | La revocación usa `seq`, no hora. El vencimiento es un control blando. Operaciones con HLC futuro quedan pendientes |
| Guardar ahora para descifrar después | Llaves P-256/ECDH | `alg` versionado; ML-DSA/ML-KEM cuando el core las exponga en `/web` |
| Abuso de la señalización gratis | Gastar el cupo compartido | JWT solo con cadena a raíz activada, cuota por sala, 8 pares; salas `p_` ya limitadas a 10 señales |

## 6. Plan por tramos

Esfuerzo: S ≤ 1 día, M 2–5 días, L 1–3 semanas. Primero va el core, porque es la base de todo lo demás. T1 y la parte de
interfaz de T2 pueden avanzar en paralelo.

| # | Tramo | Esf. | edge-mesh (core) | Fize | Pruebas | Riesgos |
|---|---|:-:|---|---|---|---|
| T0 | Arreglos de seguridad del provider | M | `web/provider.ts` (`authorizeDevice`, `canRotate`, `revokedIds` persistente, `channel`, fragmentación, `extra` en pairing), `web/pairing.ts` (SAS 6 + transcripción), `edge-mesh.ts` (firma activa por defecto) | — | Unitarias: **reproducir H1** (equipo falso no recibe wrap), revocar sin permiso = rechazo, mensaje de 1 MB fragmentado, SAS | Cambio de API para GOS/Orion: opciones nuevas opcionales |
| T1 | `web/trust` + `web/oplog` + `web/merge` | L (1–1,5 sem) | Módulos nuevos de §4 + escenarios de `security.test.ts` de Shelf portados | — | Cadena válida/forjada/expirada/profundidad; `upTo`; equivocación; orden de llegada aleatorio → misma proyección (prueba de propiedades con 3 réplicas); punto de control | Rendimiento de ECDSA en celulares baratos (medir 1k ops) |
| T2 | **Dueño + mesero/cocina**: carta, pedidos/mesas, cocina | L (~2 sem) | `workers/signaling` nivel `free-local` | `lib/mesh/{meshDb,fizeSchema,recordingAdapter,fizeVault}.ts`, `localApi.ts` (rutas de pedidos, mesas, comandas + `authorize`), `pages/local/personal.astro`, `components/local/{PairHost,PairJoin,DeviceList}.svelte`, `api/mesh/token.ts`; desplegar señalización (Decisión 4) | Unitarias de permisos por ruta; **Playwright con 3 contextos** (dueño, mesera, cocina) contra `wrangler dev` de la señalización: emparejar con SAS, mesera crea pedido → cocina lo ve → mesera no puede editar la carta (403 e interfaz) → op forjada desde la consola queda en cuarentena; desconectar y reconectar converge | WebRTC en CI (Chromium entre contextos en localhost); despliegue del DO (1 Worker) |
| T3 | Revocación completa y cuarentena | M | rotación de llaves de módulo | Pantalla de revocar con aviso de cambios sin enviar; re-anclar | Revocado no ve cambios nuevos; sus ops con `seq > upTo` se rechazan; equipo que estaba fuera se pone al día | Personal con cambios sin sincronizar |
| T4 | Inventario, caja, compras como bitácoras + poda | M | puntos de control | `localApi` (inventario, compras, pagos, turnos) | Dos cajas cobran en paralelo sin internet → totales iguales; stock = suma | Volumen en celulares (poda a 30 días) |
| T5 | Cifrado por módulo (`recetas`, `costos`, `secretos`) | L (1 sem) | `web/keyring.ts` | Campos cifrados en la proyección; `unit_cost` pasa a `costos` | Mesera con la base abierta no encuentra costos en claro (buscar en IndexedDB); rotación al revocar | Migrar datos ya en claro (re-cifrar al activar) |
| T6 | Co-admin y delegación; admin publica la carta | M | cascada en `trust` | `api/public-menu` acepta la cadena (Worker verifica sin estado, D1 solo para leer revocaciones de publicación) | Admin crea mesero; admin no crea admin; revocar admin → re-anclar | Revocaciones que el Worker no conoce: permisos de publicación con `exp` 30 días |
| T7 | Recuperación, segundo equipo del dueño, sucesión y traspaso | M | `web/recovery.ts` | Onboarding (crear R, sobre), "Recuperar dueño", "Traspasar local" | Navegador limpio + equipo de mesera + código → todo legible; sucesión invalida a la raíz robada | Texto claro para el dueño; código perdido = sin rescate |
| T8 | Shelf migra al core | L | — | — (repo Shelf) | Su `security.test.ts` contra el core | Datos Shelf en Yjs a migrar a bitácora |
| T9 | Buzón cifrado en DO (opcional) | M | DO con almacenamiento y TTL 7 días | — | Dos equipos que nunca coinciden convergen | Cupos DO/almacenamiento; decidir si es solo de pago |

## 7. Decisiones para Bel

| # | Decisión | Recomendación |
|---|---|---|
| 1 | ¿La llave del restaurante viaja a cada equipo emparejado (NODO-LOCAL §2.4)? | **No.** Solo en equipos del dueño, y su segundo equipo la obtiene con el código de recuperación. Los demás reciben un permiso firmado |
| 2 | ¿Dónde vive la lógica de permisos y replicación, y cómo se consume? | En **edge-mesh canónico** (`web/trust`, `web/oplog`, `web/keyring`, `web/recovery`), consumido fijado a commit (copia `dist` + SHA como Nido). Fize y Shelf solo tienen su esquema. Antes, arreglar H1–H3 (T0) |
| 3 | ¿Bitácora firmada o Yjs crudo para los datos del negocio? | **Bitácora firmada por equipo.** Yjs queda para presencia y lista de equipos. Es la única forma de rechazar un cambio por autor sin "aplicar y revertir" |
| 4 | ¿Qué se cifra por módulo? | `recetas`, `costos` (incluye compras/proveedores y costo unitario) y `secretos`. Ventas y caja solo por interfaz, diciendo que se pueden deducir de los pedidos |
| 5 | Señalización para el modo local gratis | Desplegar `swal-mesh-signaling` con nivel `free-local` (JWT emitido a locales activados, 8 pares, cuota) + STUN de Cloudflare. TURN solo en pago. ~190 peticiones/día por local |
| 6 | Delegación y recuperación | Dueño → admin → personal (profundidad 2; un admin no crea admins). Revocar un admin = cascada con "re-anclar". Sobre de recuperación replicado + llave sucesora R; SWAL sigue sin llave de rescate |
