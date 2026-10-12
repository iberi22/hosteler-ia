# Estándar SWAL: Emparejamiento LAN sin internet (QR / código manual)

> Canónico 2026-09-05 · Referencia: Fi'ze/hosteler-ia · Todas las apps heredan este flujo.

## Principio

Ninguna app SWAL depende de nube para operar en local. El emparejamiento
de nodos (tablets) en una LAN sin salida a internet se hace por **QR**
(primario) o **código manual** (fallback), nunca por descubrimiento
automático (el navegador no tiene mDNS) ni por Bluetooth como única vía
(Web Bluetooth no existe en iOS).

## Arquitectura (3 piezas)

1. **Signaling local**: `y-webrtc-signaling` (viene con y-webrtc, puerto
   `PORT` o 4444) corriendo en un nodo de la LAN:
   `PORT=4444 npx y-webrtc-signaling`
   Los providers y-webrtc apuntan ahí vía `signaling: [ws://<IP-LAN>:4444]`.
   Sin esto, y-webrtc usa señalización pública (internet obligatoria).
   Prioridad de resolución (meshNet.ts): override explícito → localStorage
   `swal.signaling` → env `PUBLIC_SWAL_SIGNALING` → default público.
2. **Payload QR (JSON)**: `{v:1, relay, room, key, exp, name}`. Clave
   efímera 40 bits (Crockford), TTL 5 min, un solo uso (registro del host).
   El secreto viaja fuera de banda (pantalla→cámara).
3. **Código manual**: `FZ1-<ip7><port4><key8><len1><inst><pad><chk>`
   (Crockford, checksum). Solo IPv4; hostname → solo-QR. Sin expiración
   embebida: la impone el registro del host + rotación.
   Layout: ip(7)+port(4)+key(8)+lenInst(1)+inst(1..11)+pad+chk(1).

## Room con clave

`keyedRoom = swal/{appId}/{instanceId}#k={key}`. y-webrtc une a quien
conozca el string exacto: el secreto ES la credencial (apto para LAN con
TTL corto + revocación). Revocar = limpiar registro + salir (leavePairing).

## Componentes (copiar a cada app)

- `lib/pairing.ts`: build/parse/validate + registro host + conexión persistida.
- `lib/meshNet.ts`: resolución de signaling.
- `stores/pairing.svelte.ts`: issue/join/leave/confirm + reseteo del bus P2P.
- `components/RealQr.svelte`: QR ESCANEABLE (qrcode-generator). El
  `QRCode.svelte` legacy es un placeholder NO escaneable (no usar para pairing).
- `components/pairing/PairScanner.svelte`: BarcodeDetector + getUserMedia
  con timeout 4s → fallback manual. Botón explícito "Tengo un código".
- `components/pairing/PairModal.svelte`: tabs host/join + `data-hydrated`
  para tests determinísticos (clicks pre-hidratación = flakes).
- Página `/pair` + entrada en nav.

## Seguridad LAN (modelo de amenaza honesto)

- Atacante fuera de la LAN: no ve nada (tráfico local).
- Atacante en la LAN pasivo: el QR/código se muestra hombro-a-hombro;
  TTL 5 min + un solo uso + revocación limitan la ventana.
- NO es E2E contra un atacante LAN activo con tiempo: para eso está
  el vault cifrado (nube socios) y el handshake PQC del core. Documentar,
  no prometer de más.

## Puesta en producción (restaurante)

1. Un nodo (mini-PC o tablet fija) corre `y-webrtc-signaling` en :4444.
2. Cada tablet abre /pair → "Mostrar mi QR" con `ws://<IP-nodo>:4444`.
3. Las demás escanean o tiran código. Listo: P2P sin internet.
4. BLE queda como fase 2 (solo Android) para handshake sin cámara.
