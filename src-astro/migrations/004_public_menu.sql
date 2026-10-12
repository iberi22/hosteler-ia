-- Carta publicada desde un nodo local (docs/producto/NODO-LOCAL.md §2.5).
-- La carta (JSON ya limpio) vive en R2 `public/menu/<slug>.json`; aqui solo el dueño del slug y el cupo.
-- Por publicación: 1 fila escrita (2 la primera vez: el código y el registro). 0 KV.
-- Idempotente. Aplicar (desde src-astro/): npx wrangler d1 migrations apply SWAL_D1 --remote
-- (D1 propia `fize-db`; antes vivia en la compartida `swal-billing`). Solo crea estas dos tablas.

-- Un slug = una llave de restaurante. publish_day/publish_count: cupo de 30 publicaciones por día UTC.
CREATE TABLE IF NOT EXISTS public_menu (
  slug TEXT PRIMARY KEY,
  pubkey_fp TEXT NOT NULL,
  pubkey_jwk TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  publish_day TEXT NOT NULL,
  publish_count INTEGER NOT NULL DEFAULT 0
);

-- Códigos de activación que entrega SWAL (scripts/activation-code.mjs). Solo el SHA-256 del código.
-- slug NULL = sirve para cualquier slug; con slug = solo para ese. Un uso.
CREATE TABLE IF NOT EXISTS public_menu_activation (
  code_hash TEXT PRIMARY KEY,
  slug TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_by_fp TEXT
);
