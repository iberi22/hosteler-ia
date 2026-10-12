-- D1 base de Fize: meta de los sealed packs del vault (ciphertext en R2, solo hash + llave en D1).
-- Aplicar (desde src-astro/): npx wrangler d1 migrations apply SWAL_D1 --local --config wrangler.e2e.jsonc
--   (o --remote con tu propio wrangler.jsonc, copiado de wrangler.example.jsonc).
--
-- Antes vivia dentro de 001_billing.sql junto con las tablas de facturacion (credits, invoices,
-- subscriptions). La facturacion es del modulo cloud opcional, asi que se separo: este archivo es lo unico
-- que la app local-first necesita de 001. Todo es IF NOT EXISTS: sobre una base que ya aplico
-- 001_billing.sql no cambia nada.

CREATE TABLE IF NOT EXISTS sealed_meta (
  id TEXT PRIMARY KEY,
  appId TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- Antes la agregaba 003 con ALTER; va aqui para que una base vacia quede bien aunque el Worker
  -- (cloudflareVaultAdapter.ensureSchema) haya creado la tabla antes que las migraciones. Ver 003.
  cloud_share TEXT
);

CREATE INDEX IF NOT EXISTS idx_sealed_meta_app_instance ON sealed_meta(appId, instance_id);
CREATE INDEX IF NOT EXISTS idx_sealed_meta_entity ON sealed_meta(entity);
CREATE INDEX IF NOT EXISTS idx_sealed_meta_hash ON sealed_meta(content_hash);
