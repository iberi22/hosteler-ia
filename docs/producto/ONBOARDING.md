# Fize — Onboarding de restaurantes

> Fecha: 2026-10-02. Parte de [ALCANCE.md](ALCANCE.md). Rutas relativas a la raíz del repo.
> Objetivo: que un restaurante tenga su **carta publicada y su primer QR impreso en menos de 10 minutos**.

---

## 1. Puertas de entrada

| Entrada | De dónde viene | Qué llega precargado | Fase |
|---------|----------------|----------------------|------|
| **CTA de la landing** "Registrar mi restaurante" | `fize.swal.network` | Nada | 1 |
| **Reclamar ficha** "¿Es tu negocio?" | Ficha del directorio (OpenStreetMap) | Nombre, ubicación, tipo de cocina, horario (si OSM los tiene). Ver [DIRECTORIO.md](DIRECTORIO.md) §5 | 2 |
| **Invitación** | Enlace que envía un dueño a su personal | Restaurante y rol. El invitado salta directo a "crear cuenta" y entra al panel | 1 |
| **Asistido por SWAL** | Visita o llamada (cliente de hoy) | Lo que SWAL cargue con el dueño | 0 |

## 2. Fase 0 — Onboarding asistido para el cliente de hoy

Con las pantallas actuales, sin asistente. Lo hace una persona de SWAL junto al dueño.

| Paso | Dónde | Notas |
|------|-------|-------|
| 1. Despliegue dedicado con instancia propia | `private/infra/scripts/deploy-tenant.sh <slug> [hostname]` (hecho y probado 2026-10-02): Worker `fize-<slug>` con `PUBLIC_FIZE_INSTANCE_ID=<slug>`, subdominio de un solo nivel (`fize-<slug>.swal.network`) | [ALCANCE.md](ALCANCE.md) §6.3. El primer registro en ese dominio queda como dueño: hacerlo con el cliente presente |
| 2. Cuenta del dueño | `/register` (`src-astro/src/components/auth/RegisterForm.svelte`) | El primer usuario de la instancia queda como `owner` (`src-astro/src/pages/api/auth/register.ts`) |
| 3. Datos del local | `/dashboard/settings` (`src-astro/src/components/settings/RestaurantForm.svelte`) | Nombre, slug, dirección. **WhatsApp:** no hay campo en la interfaz hasta la tarea 0.3; mientras tanto se guarda con `PATCH /api/restaurants/{id}` `{ "phone": "..." }` con la sesión del dueño |
| 4. Carta | `/dashboard/menu` | Categorías y platos. Marcar platos no públicos si los hay (`isPublic`) |
| 5. Mesas y QR | `/dashboard/tables` | Imprimir los QR |
| 6. Personal | Con sesión del dueño, `POST /api/auth/register` crea cuentas `staff` | Ojo: hoy `staff` tiene los mismos poderes que el dueño (no hay control por rol). Darle cuenta solo a personas de confianza |
| 7. Verificar | Abrir `/{slug}/menu` en un celular, pedir por WhatsApp, hacer un pedido de mesa y verlo en `/dashboard/kitchen` | `src-astro/scripts/smoke-public-menu.mjs` verifica la carta pública desplegada |

## 3. Asistente (Fase 1)

Seis pantallas. Cada una se puede saltar y retomar; el progreso queda en el panel de Inicio como lista de "siguientes pasos".
Barra superior fija: `Paso n de 6 · Guardar y salir`.

### Paso 1 — Cuenta del dueño

```
┌──────────────────────────────────────────────┐
│ Fize                         Paso 1 de 6     │
│                                              │
│  Crea tu cuenta                              │
│  Gratis. Sin tarjeta. Tus datos son tuyos.   │
│                                              │
│  Tu nombre      [______________________]     │
│  Correo         [______________________]     │
│  Contraseña     [______________________] (ver)  │
│                 mínimo 8 caracteres          │
│                                              │
│  [✓] Acepto los Términos y la Política de    │
│      privacidad (enlaces)                    │
│  [ ] Enviar informes de errores a SWAL       │
│      (sin datos de tu negocio)               │
│                                              │
│            [ Crear cuenta → ]                │
│  ¿Ya tienes cuenta? Entrar                   │
└──────────────────────────────────────────────┘
```

| Se guarda | Dónde | Cifrado |
|-----------|-------|---------|
| Nombre, correo, hash PBKDF2 de la contraseña, rol `owner` | Registro `user` sellado (D1 `sealed_meta` + R2) | Cifrado en reposo; legible por el servidor (necesario para autenticar) |
| Aceptación de T&C (versión y fecha) | En el registro `user` | Igual |
| Preferencia de telemetría | En el registro `user`; por defecto **desactivada** | Igual |

Criterios de aceptación:
- [ ] Correo inválido o contraseña < 8 caracteres → error en el campo, sin enviar.
- [ ] Sin marcar T&C, el botón queda deshabilitado.
- [ ] Correo ya registrado → mensaje "Ese correo ya tiene cuenta" + enlace a Entrar (HTTP 409 de la API).
- [ ] Al crear: se emite la cookie `fize_session` (HttpOnly, SameSite=Lax) y se pasa al paso 2.
- [ ] La casilla de telemetría aparece desmarcada.
- [ ] En Fase 2 (multi-tenant) crear cuenta no crea restaurante todavía: el restaurante nace en el paso 2.

### Paso 2 — Datos del local

```
┌──────────────────────────────────────────────┐
│ Paso 2 de 6 · Tu negocio                     │
│                                              │
│  Nombre del negocio [Asadero Don Pepe_____]  │
│  Enlace de tu carta                          │
│   fize.swal.network/[asadero-don-pepe] ✓     │
│                                              │
│  WhatsApp para pedidos [+57 300 123 4567]    │
│                                              │
│  Dirección [Cra 15 # 85-20, Bogotá______]    │
│  ┌────────────────────────────────────────┐  │
│  │            mapa  ◉ (arrástrame)        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Tipo de cocina  (colombiana)(asados)(+)     │
│  Precio promedio  ( $ ) ( $$ ) ( $$$ )       │
│                                              │
│  Horario                                     │
│   Lun–Vie  [11:30]–[15:30]  [+ franja]       │
│   Sáb      [11:30]–[16:00]                   │
│   Dom      [Cerrado]                         │
│                                              │
│   [← Atrás]                [ Seguir → ]      │
└──────────────────────────────────────────────┘
```

Reglas:
- **Slug**: se sugiere desde el nombre (minúsculas, sin tildes, `a-z0-9-`, 3–40 caracteres). Palabras reservadas: `api`, `dashboard`, `login`, `register`, `registrar`, `table`, `menu`, `cerca`, `directorio`, `admin`, `checkout`, `pair`, `offline`, `order-confirmation`. Único en toda la plataforma (Fase 2; en Fase 1, único en la instancia). Si está tomado, se proponen 3 alternativas (`-bogota`, `-chapinero`, `-2`).
- **WhatsApp**: se normaliza con `normalizeColombianPhone` (`src-astro/src/lib/domain.extensions.ts`). Opcional, pero sin él el botón "Pedir por WhatsApp" no aparece (comportamiento actual de `PublicMenu.svelte`).
- **Ubicación**: la dirección se geocodifica **desde el navegador del dueño** con Nominatim (OSM; máximo 1 consulta por segundo, una sola vez) y el pin se ajusta a mano. Mapa con teselas gratuitas (OpenFreeMap o PMTiles propias en R2), con atribución © OpenStreetMap. Si falla, se guarda solo la dirección y el pin queda pendiente.
- **Tipo de cocina**: lista cerrada compatible con la etiqueta `cuisine` de OSM (colombiana, corrientazo, asados, comida rápida, pizza, hamburguesas, pollo, panadería, café, mariscos, vegetariana, saludable, internacional…), máximo 3.
- **Horario**: se guarda estructurado por día (minutos desde medianoche, zona `America/Bogota`) y también como texto `opening_hours` de OSM para el directorio.

| Se guarda | Dónde | Cifrado / visibilidad |
|-----------|-------|-----------------------|
| Nombre, slug, WhatsApp, dirección, lat/lon, cocina, precio, horario | Registro `restaurant` sellado | Cifrado en reposo. Son **datos públicos por elección** (clase A): salen en la instantánea pública solo al publicar (paso 6) |
| Slug → instancia | Tabla D1 `tenant` (Fase 2) | En claro (es la URL pública) |

Criterios de aceptación:
- [ ] El slug sugerido cumple el formato; uno reservado o tomado muestra el motivo y 3 alternativas en < 500 ms.
- [ ] Dos restaurantes no pueden quedar con el mismo slug (prueba: segundo `POST /api/restaurants` con el mismo slug → 409).
- [ ] `3001234567`, `300 123 4567` y `+57 300 123 4567` se guardan igual.
- [ ] Si la geocodificación falla o no hay red, se puede seguir sin pin.
- [ ] Un horario con fin antes del inicio se rechaza, salvo que se marque "pasa de medianoche".
- [ ] Nada de este paso es visible en `/{slug}/menu` hasta publicar.

### Paso 3 — Carta

```
┌──────────────────────────────────────────────┐
│ Paso 3 de 6 · Tu carta                       │
│                                              │
│  Empieza con una plantilla (puedes editarla) │
│  [Corrientazo] [Comidas rápidas] [Cafetería] │
│  [Panadería] [Asadero] [Pizzería] [En blanco]│
│                                              │
│  ▸ Almuerzos                      [+ plato]  │
│    Ejecutivo del día      $ 16.000   [ed][x] │
│    Bandeja paisa          $ 28.000   [ed][x] │
│  ▸ Bebidas                        [+ plato]  │
│    Jugo natural           $  6.000   [ed][x] │
│  [+ categoría]                               │
│                                              │
│  Agregar rápido:                             │
│  [Nombre del plato____] [$ precio] [Agregar] │
│                                              │
│  Próximamente: importar desde foto o PDF     │
│   [← Atrás]     [Saltar]      [ Seguir → ]   │
└──────────────────────────────────────────────┘
```

- **Agregar rápido**: nombre + precio + Enter. La descripción, foto, receta y vínculos GOS se completan después en `/dashboard/menu` y `/dashboard/recipes`.
- **Plantillas**: categorías y platos típicos con precio vacío o de referencia, marcados "revisar precio". El dueño borra lo que no aplica.
- **Importar desde foto/PDF/texto**: mejora futura (Fase 4). Pegar texto ("Bandeja paisa 28000" por línea) es el primer paso barato y puede adelantarse a Fase 1 porque no usa IA.

| Se guarda | Dónde | Cifrado / visibilidad |
|-----------|-------|-----------------------|
| Categorías y platos (nombre, precio, descripción, `isPublic`) | Registros `category` y `menuItem` sellados | Cifrado en reposo. Los platos públicos salen en la instantánea al publicar |
| Recetas, costos | Registros `recipe`, `inventoryItem` | Privados (clase B). Nunca entran en la instantánea (`publicMenuBySlug.ts` ya filtra recetas y descripciones internas) |

Criterios de aceptación:
- [ ] Con "Agregar rápido" se cargan 10 platos en < 2 minutos (prueba cronometrada con usuario nuevo).
- [ ] Una plantilla crea sus categorías y platos una sola vez aunque se pulse dos veces (idempotente).
- [ ] Precio vacío o 0 → el plato queda marcado "sin precio" y no sale en la carta pública.
- [ ] Una descripción con "receta", "inventario", "costo", "proveedor" o "compras" no se publica (regla actual `sanitizePublicDescription`).
- [ ] Se puede seguir con al menos 1 plato; con 0 platos, "Seguir" pide confirmación.

### Paso 4 — Mesas y QR

```
┌──────────────────────────────────────────────┐
│ Paso 4 de 6 · Mesas                          │
│                                              │
│  ¿Atiendes en mesa?   (•) Sí   ( ) Solo      │
│                                 domicilio/   │
│                                 para llevar  │
│  ¿Cuántas mesas?  [ 8 ]  puestos c/u [ 4 ]   │
│                                              │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                 │
│  │▓▓▓▓│ │▓▓▓▓│ │▓▓▓▓│ │▓▓▓▓│  vista previa   │
│  │M 1 │ │M 2 │ │M 3 │ │M 4 │                 │
│  └────┘ └────┘ └────┘ └────┘                 │
│                                              │
│  [Descargar hoja para imprimir (PDF A4)]     │
│  [Descargar QR general de la carta (PNG)]    │
│   [← Atrás]     [Saltar]      [ Seguir → ]   │
└──────────────────────────────────────────────┘
```

- Crea N mesas con su `qrCode` (`src-astro/src/pages/api/tables/index.ts`, `src-astro/src/lib/tableQr.ts`). El QR de mesa abre `/table/{qrCode}`; el QR general abre `/{slug}/menu`.
- Hoja A4: 6 QR por página con nombre del negocio, número de mesa y "Escanea para ver la carta". Se genera en el navegador (sin servidor).

| Se guarda | Dónde | Cifrado |
|-----------|-------|---------|
| Mesas (número, capacidad, código QR) | Registros `table` sellados | Cifrado en reposo; el código QR es público por naturaleza (va impreso) |

Criterios de aceptación:
- [ ] "8 mesas" crea exactamente 8 registros; repetir el paso no duplica (se ofrece "agregar más").
- [ ] Cada QR de la hoja abre su mesa correcta (prueba: escanear mesa 3 → `/table/<código de la mesa 3>`).
- [ ] "Solo domicilio/para llevar" no crea mesas y ofrece solo el QR general.
- [ ] El PDF se genera sin red una vez cargada la página.

### Paso 5 — Invitar personal

```
┌──────────────────────────────────────────────┐
│ Paso 5 de 6 · Tu equipo                      │
│                                              │
│  Nombre         Rol                          │
│  [Marta_____]   [Caja      ▾]   [Invitar]    │
│                                              │
│  Invitaciones                                │
│   Marta · Caja · enlace válido 72 h          │
│   [Copiar enlace] [Enviar por WhatsApp] [✕]  │
│                                              │
│  Tableta de cocina                           │
│   [Emparejar tableta con QR]                 │
│   (no necesita correo; queda con rol Cocina) │
│                                              │
│   [← Atrás]     [Saltar]      [ Seguir → ]   │
└──────────────────────────────────────────────┘
```

- **Invitación**: enlace de un solo uso, 72 h, con rol fijado (`staff`, `caja`, `cocina`). El invitado pone su correo y contraseña. Reemplaza que el dueño cree contraseñas ajenas (cómo funciona hoy).
- **Tableta de cocina**: emparejamiento por QR (`src-astro/src/lib/pairing.ts`, `src-astro/src/pages/pair.astro`); el dispositivo queda con rol `cocina`, sin correo.
- Roles y permisos: matriz en [ALCANCE.md](ALCANCE.md) §6.2.

| Se guarda | Dónde | Cifrado |
|-----------|-------|---------|
| Invitación (token con hash, rol, vence) | D1 (fila corta; **no KV**) | Solo se guarda el hash del token |
| Pertenencia usuario–restaurante–rol | Tabla `membership` (Fase 2) / registro `user` (Fase 1) | Cifrado en reposo |

Criterios de aceptación:
- [ ] Un enlace usado o vencido responde "Esta invitación ya no es válida".
- [ ] Un usuario `cocina` que pide `/dashboard/purchases` o `GET /api/purchases` recibe 403.
- [ ] Un usuario `caja` no ve costos de recetas (campo ausente en la respuesta, no solo oculto).
- [ ] Revocar una invitación pendiente la invalida de inmediato.
- [ ] Sin dueño con sesión, `POST /api/auth/register` sigue devolviendo 403 (regla actual).

### Paso 6 — Publicar y compartir

```
┌──────────────────────────────────────────────┐
│ Paso 6 de 6 · Publica tu carta               │
│                                              │
│  Vista previa (como la ve tu cliente)        │
│  ┌──────────────┐                            │
│  │ Asadero      │  Qué se publica:           │
│  │ Don Pepe     │  [✓] Carta y precios       │
│  │ Abierto ·    │  [✓] Dirección y mapa      │
│  │ cierra 3:30  │  [✓] Horario               │
│  │ Almuerzos ▸  │  [✓] Botón de WhatsApp     │
│  └──────────────┘                            │
│                                              │
│  ¿Aparecer en "Menús cerca de mí"?           │
│   ( ) Sí, que me encuentren   ( ) Ahora no   │
│                                              │
│            [ Publicar carta ]                │
│                                              │
│  ✓ Publicada: fize.swal.network/asadero-...  │
│  [Copiar enlace] [Compartir por WhatsApp]    │
│  [Descargar QR] [Ir al panel →]              │
└──────────────────────────────────────────────┘
```

- **Publicar** genera la instantánea pública (JSON con solo los campos marcados) y la sube a R2 servida por CDN ([ALCANCE.md](ALCANCE.md) §4.4). Cada cambio posterior en la carta muestra "Tienes cambios sin publicar".
- **Directorio**: elección explícita, sin opción premarcada. Se puede cambiar en Ajustes.

Criterios de aceptación:
- [ ] Tras publicar, `GET /{slug}/menu` responde 200 y contiene todos los platos públicos con precio.
- [ ] La instantánea no contiene recetas, costos, inventario, proveedores, `instance_id` ni marcas de tiempo internas (prueba automática sobre el JSON).
- [ ] Desmarcar "Botón de WhatsApp" lo quita de la carta pública tras publicar.
- [ ] "Ahora no" en el directorio → el restaurante no aparece en ningún archivo del índice ([DIRECTORIO.md](DIRECTORIO.md)).
- [ ] Publicar escribe 1 objeto R2 y 0 claves KV.

## 4. Qué se guarda y dónde (resumen)

| Dato | Almacén hoy | Legible por el servidor hoy | Fase 3 |
|------|-------------|:--------------------------:|--------|
| Cuenta (correo, hash) | Vault: D1 `sealed_meta` + R2 | Sí | Sí (necesario) |
| Datos del local | Vault | Sí | Público por elección → instantánea en claro; el resto E2EE |
| Carta | Vault | Sí | Borrador E2EE; versión publicada en claro |
| Recetas, costos, inventario, compras | Vault | Sí | **No** (E2EE) |
| Mesas y QR | Vault | Sí | E2EE salvo el código impreso |
| Pedidos de comensales | Vault | Sí | Cifrados a la llave del restaurante |
| Invitaciones | D1 | Solo hash | Igual |
| Instantánea pública | R2 + CDN | Sí (es pública) | Igual |

Ninguna escritura del onboarding usa KV (cupo de 1.000 escrituras/día para toda la cuenta).

## 5. Estados vacíos

| Pantalla | Mensaje | Acción |
|----------|---------|--------|
| Inicio sin onboarding completo | "Te faltan 3 pasos para recibir pedidos" | Lista de pasos pendientes con enlace |
| Carta sin platos | "Tu carta está vacía. Empieza con una plantilla o agrega tu primer plato." | Plantillas · Agregar plato |
| Pedidos / Cocina sin pedidos | "Aún no hay pedidos. Comparte tu QR o tu enlace." | Copiar enlace · Descargar QR |
| Inventario vacío | "Agrega tus insumos para que el inventario se descuente solo con cada venta." | Agregar insumo |
| Recetas vacías | "Une un plato con sus insumos y Fize calcula el costo por porción." | Crear receta |
| Analítica sin datos | "Aquí verás tus ventas cuando registres el primer cobro." | — |
| Carta pública sin publicar | (para el comensal) "Esta carta todavía no está publicada." HTTP 404 | — |

## 6. Meta de tiempo a primer valor

**Menos de 10 minutos** desde "Registrar mi restaurante" hasta la carta publicada con su QR.

| Paso | Tiempo objetivo |
|------|-----------------|
| 1. Cuenta | 1 min |
| 2. Local | 2 min |
| 3. Carta (plantilla + ajustar 10 platos) | 4 min |
| 4. Mesas y QR | 1 min |
| 5. Personal (saltable) | 1 min |
| 6. Publicar | 1 min |

Cómo se mide sin rastrear: prueba con 3 dueños reales y cronómetro, y en la app un campo local `onboardingStartedAt/CompletedAt` que solo ve el dueño (y SWAL si aceptó telemetría).
