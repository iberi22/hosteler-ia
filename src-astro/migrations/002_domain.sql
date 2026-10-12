-- D1 domain generic — tablas por entity definidas en domain.config.ts
-- Generado via surrealDefineTable() y DDL D1: se crea una tabla por entity con instance_id isolation.
-- Ejecutar despues de 001: wrangler d1 execute swal-domain --file=./migrations/002_domain.sql
-- NOTA: este archivo es plantilla; cada app genera su propio 002 via pnpm run gen:tables

-- Ejemplo para app 'my-app' con entities item/order:
-- CREATE TABLE IF NOT EXISTS item (
--   id TEXT PRIMARY KEY,
--   instance_id TEXT NOT NULL,
--   created_at TEXT NOT NULL,
--   updated_at TEXT NOT NULL,
--   name TEXT,
--   price TEXT,
--   status TEXT
-- );
-- CREATE INDEX IF NOT EXISTS idx_item_instance ON item(instance_id);

-- En modo vault cifrado, estas tablas NO se usan: sealed_meta + R2 guarda ciphertext.
-- En modo mesh-only, estas tablas son Yjs IndexedDB local, no D1.
-- En modo D1 plaintext (dev sin vault), descomentar y usar.

-- Vault mode (default): solo sealed_meta en D1 + R2 ciphertext.
-- No DDL adicional requerido si usas CloudflareVaultAdapter.
