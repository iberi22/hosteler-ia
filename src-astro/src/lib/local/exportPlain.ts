import { collectBackup, downloadText } from './backupData';
import type { PlainBackup } from './backupCrypto';
import { domainConfig } from '../domain.config';

function quoteSqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function assertIdentifier(id: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(id)) {
    throw new Error(`Invalid identifier: ${id}`);
  }
}

const BASE_FIELDS = ['id', 'instance_id', 'created_at', 'updated_at', 'deleted_at'] as const;

function filterRecord(entityName: string, record: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set<string>(BASE_FIELDS);
  const entityDef = domainConfig.entities.find((e) => e.name === entityName);
  if (entityDef) {
    for (const f of entityDef.fields) {
      allowed.add(f);
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (allowed.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

export function buildPlainJson(backup: PlainBackup): string {
  const filteredStores: Record<string, unknown[]> = {};

  for (const [entityName, records] of Object.entries(backup.stores)) {
    if (entityName === 'session') {
      // Exclude session tokens completely (do not export the session entity)
      continue;
    }
    filteredStores[entityName] = (records as Record<string, unknown>[]).map((r) => filterRecord(entityName, r));
  }

  const local = backup.local as any;
  const identity = local?.identity;

  const plainObj = {
    format: backup.format,
    appId: backup.appId,
    createdAt: backup.createdAt,
    schemaVersion: backup.schemaVersion,
    stores: filteredStores,
    local: {
      identity: identity ? {
        instanceId: identity.instanceId,
        createdAt: identity.createdAt,
      } : undefined,
      onboarding: local?.onboarding,
      settings: local?.settings,
    },
  };

  return JSON.stringify(plainObj, null, 2);
}

export function buildSqlDump(backup: PlainBackup): string {
  const lines: string[] = [];
  lines.push('PRAGMA foreign_keys=OFF;');
  lines.push('BEGIN;');

  lines.push('CREATE TABLE IF NOT EXISTS "_export_meta" (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('format', ${quoteSqlStr(backup.format)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('app_id', ${quoteSqlStr(backup.appId)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('exported_at', ${quoteSqlStr(backup.createdAt)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('schema_version', ${quoteSqlStr(String(backup.schemaVersion))});`);

  for (const [entityName, records] of Object.entries(backup.stores)) {
    if (entityName === 'session') {
      continue;
    }
    assertIdentifier(entityName);
    lines.push(`CREATE TABLE IF NOT EXISTS "${entityName}" (id TEXT PRIMARY KEY, instance_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, data TEXT NOT NULL);`);

    for (const r of records as Record<string, unknown>[]) {
      const rec = filterRecord(entityName, r);
      const id = typeof rec.id === 'string' ? rec.id : '';
      const instance_id = typeof rec.instance_id === 'string' ? rec.instance_id : '';
      const created_at = typeof rec.created_at === 'string' ? rec.created_at : '';
      const updated_at = typeof rec.updated_at === 'string' ? rec.updated_at : '';
      const deleted_at = typeof rec.deleted_at === 'string' ? rec.deleted_at : null;

      const dataStr = JSON.stringify(rec);

      const vDeleted = deleted_at !== null ? quoteSqlStr(deleted_at) : 'NULL';

      lines.push(`INSERT INTO "${entityName}" (id, instance_id, created_at, updated_at, deleted_at, data) VALUES (${quoteSqlStr(id)}, ${quoteSqlStr(instance_id)}, ${quoteSqlStr(created_at)}, ${quoteSqlStr(updated_at)}, ${vDeleted}, ${quoteSqlStr(dataStr)});`);
    }
  }

  lines.push('COMMIT;');
  return lines.join('\n');
}

export async function exportMyDataFiles(): Promise<{ json: string; sql: string; baseName: string }> {
  const backup = await collectBackup();

  const restaurant = (backup.stores.restaurant ?? []).find((r) => !(r as Record<string, unknown>).deleted_at) as
    | Record<string, unknown>
    | undefined;
  const slug = typeof restaurant?.slug === 'string' && restaurant.slug ? restaurant.slug : 'mi-local';

  const ymd = new Date().toISOString().slice(0, 10);
  const baseName = `fize-${slug}-datos-${ymd}`;

  const json = buildPlainJson(backup);
  const sql = buildSqlDump(backup);

  return { json, sql, baseName };
}

export async function exportMyData(kind: 'json' | 'sql'): Promise<void> {
  const { json, sql, baseName } = await exportMyDataFiles();
  if (kind === 'json') {
    downloadText(json, `${baseName}.json`, 'application/json');
  } else {
    downloadText(sql, `${baseName}.sql`, 'application/sql');
  }
}
