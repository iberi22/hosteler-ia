-- Contador de intentos fallidos de login (src-astro/src/lib/auth/rateLimit.ts).
-- Antes vivia en KV (SWAL_KV): cada intento fallido era una escritura KV y la cuota
-- gratuita de KV (1.000 escrituras/dia PARA TODA LA CUENTA de Cloudflare) se quemaba
-- en login (16-22 % medido). Ahora es una fila por llave en D1 (100.000 filas/dia).
-- Ventana deslizante de 60 s: cada intento renueva window_start; la lectura ignora la
-- fila cuando now - window_start >= 60.000 ms. Sin cron y sin borrados: las filas de
-- llaves que no vuelven ocupan ~40 bytes y se sobrescriben si reaparecen.
-- Idempotente. Aplicar ANTES de desplegar el Worker, desde src-astro/:
--   npx wrangler d1 migrations apply SWAL_D1 --remote
-- Sobre `fize-db` (vacia, propia de Fize) `migrations apply` corre 001-005 en orden sin errores
-- (003 ya no hace ALTER; ver su cabecera). En una base vieja migrada a mano con `d1 execute`, sin
-- registro en d1_migrations, este archivo se puede aplicar suelto con `d1 execute --file`.
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
