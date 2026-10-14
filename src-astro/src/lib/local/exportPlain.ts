import { collectBackup, downloadText } from './backupData';
import type { PlainBackup } from './backupCrypto';
import { domainConfig } from '../domain.config';

// List of strictly allowed stores to export, per instruction: "The plain export must exclude every credential: the session store (token and any refresh material)"
const ALLOWED_STORES = domainConfig.entities.map(e => e.name).filter(name => name !== 'session');

export function buildPlainJson(backup: PlainBackup): string {
  const allowedStores: Record<string, unknown[]> = {};
  for (const name of ALLOWED_STORES) {
    if (backup.stores[name]) {
      allowedStores[name] = backup.stores[name];
    }
  }

  const plainBackup = {
    ...backup,
    stores: allowedStores,
    local: {
      ...backup.local,
      identity: {
        instanceId: (backup.local?.identity as any)?.instanceId,
        createdAt: (backup.local?.identity as any)?.createdAt,
      },
      // Keep onboarding and settings
      onboarding: backup.local?.onboarding,
      settings: backup.local?.settings,
    }
  };

  // Ensure recoveryCode is excluded if present in local
  if (plainBackup.local && 'recoveryCode' in plainBackup.local) {
    delete (plainBackup.local as any).recoveryCode;
  }

  return JSON.stringify(plainBackup, null, 2);
}

function escapeSqlString(str: string): string {
  return `'${str.replace(/'/g, "''")}'`;
}

export function buildSqlDump(backup: PlainBackup): string {
  const lines: string[] = [];
  lines.push('PRAGMA foreign_keys=OFF;');
  lines.push('BEGIN;');
  lines.push('CREATE TABLE IF NOT EXISTS "_export_meta" (key TEXT PRIMARY KEY, value TEXT NOT NULL);');

  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('format', ${escapeSqlString(backup.format)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('appId', ${escapeSqlString(backup.appId)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('exportedAt', ${escapeSqlString(backup.createdAt)});`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('schemaVersion', ${escapeSqlString(String(backup.schemaVersion))});`);

  for (const entity of domainConfig.entities) {
    if (entity.name === 'session') continue; // Do not export sessions

    const tableName = entity.name;
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }

    lines.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (id TEXT PRIMARY KEY, instance_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, data TEXT NOT NULL);`);

    const records = backup.stores[tableName] || [];
    for (const record of records as any[]) {
      const id = record.id;
      const instance_id = record.instance_id || (backup.local?.identity as any)?.instanceId;
      const created_at = record.created_at || null;
      const updated_at = record.updated_at || null;
      const deleted_at = record.deleted_at || null;

      const idVal = escapeSqlString(id);
      const instanceIdVal = escapeSqlString(instance_id);
      const createdAtVal = created_at ? escapeSqlString(created_at) : 'NULL';
      const updatedAtVal = updated_at ? escapeSqlString(updated_at) : 'NULL';
      const deletedAtVal = deleted_at ? escapeSqlString(deleted_at) : 'NULL';
      const dataVal = escapeSqlString(JSON.stringify(record));

      lines.push(`INSERT INTO "${tableName}" (id, instance_id, created_at, updated_at, deleted_at, data) VALUES (${idVal}, ${instanceIdVal}, ${createdAtVal}, ${updatedAtVal}, ${deletedAtVal}, ${dataVal});`);
    }
  }

  lines.push('COMMIT;');
  lines.push(''); // Trailing newline
  return lines.join('\n');
}

export async function exportMyDataFiles(): Promise<{ json: string; sql: string; baseName: string }> {
  const backup = await collectBackup();
  const json = buildPlainJson(backup as PlainBackup);
  const sql = buildSqlDump(backup as PlainBackup);

  let slug = 'mi-local';
  if (backup.stores.restaurant && Array.isArray(backup.stores.restaurant)) {
    const activeRest = backup.stores.restaurant.find((r: any) => !r.deleted_at) as Record<string, unknown> | undefined;
    if (activeRest && typeof activeRest.slug === 'string') {
      slug = activeRest.slug;
    }
  }

  const dateStr = backup.createdAt.slice(0, 10);
  const baseName = `fize-${slug}-datos-${dateStr}`;

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
