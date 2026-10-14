import { domainConfig } from '../domain.config';
import type { PlainBackup } from './backupCrypto';
import { collectBackup, downloadText } from './backupData';

export function buildPlainJson(backup: PlainBackup): string {
  const strippedBackup = {
    ...backup,
    local: backup.local ? {
      ...backup.local,
      identity: backup.local.identity ? {
        instanceId: (backup.local.identity as any).instanceId,
        createdAt: (backup.local.identity as any).createdAt,
      } : undefined,
      recoveryCode: undefined,
    } : undefined
  };
  return JSON.stringify(strippedBackup, null, 2);
}

export function buildSqlDump(backup: PlainBackup): string {
  const lines: string[] = [];
  lines.push('PRAGMA foreign_keys=OFF;');
  lines.push('BEGIN;');

  lines.push(`CREATE TABLE IF NOT EXISTS "_export_meta" (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('format', '${String(backup.format).replace(/'/g, "''")}');`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('appId', '${String(backup.appId).replace(/'/g, "''")}');`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('createdAt', '${String(backup.createdAt).replace(/'/g, "''")}');`);
  lines.push(`INSERT INTO "_export_meta" (key, value) VALUES ('schemaVersion', '${String(backup.schemaVersion).replace(/'/g, "''")}');`);

  const entities = domainConfig.entities.map(e => e.name);

  for (const entity of entities) {
    if (!/^[A-Za-z0-9_]+$/.test(entity)) {
      throw new Error(`Invalid entity name: ${entity}`);
    }
    lines.push(`CREATE TABLE IF NOT EXISTS "${entity}" (id TEXT PRIMARY KEY, instance_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, data TEXT NOT NULL);`);
    const records = backup.stores[entity] || [];
    for (const record of records) {
      const rec = record as Record<string, any>;
      const id = typeof rec.id === 'string' ? rec.id : '';
      const instance_id = typeof rec.instance_id === 'string' ? rec.instance_id : '';
      const created_at = typeof rec.created_at === 'string' ? rec.created_at : '';
      const updated_at = typeof rec.updated_at === 'string' ? rec.updated_at : '';

      const idVal = id ? `'${id.replace(/'/g, "''")}'` : 'NULL';
      const instanceIdVal = instance_id ? `'${instance_id.replace(/'/g, "''")}'` : 'NULL';
      const createdAtVal = created_at ? `'${created_at.replace(/'/g, "''")}'` : 'NULL';
      const updatedAtVal = updated_at ? `'${updated_at.replace(/'/g, "''")}'` : 'NULL';
      const deletedAtVal = rec.deleted_at ? `'${String(rec.deleted_at).replace(/'/g, "''")}'` : 'NULL';

      const dataStr = JSON.stringify(rec);
      const dataVal = `'${dataStr.replace(/'/g, "''")}'`;

      lines.push(`INSERT INTO "${entity}" (id, instance_id, created_at, updated_at, deleted_at, data) VALUES (${idVal}, ${instanceIdVal}, ${createdAtVal}, ${updatedAtVal}, ${deletedAtVal}, ${dataVal});`);
    }
  }

  lines.push('COMMIT;');
  return lines.join('\n') + '\n';
}

export async function exportMyDataFiles(): Promise<{json: string; sql: string; baseName: string}> {
  const backup = await collectBackup();
  const json = buildPlainJson(backup);
  const sql = buildSqlDump(backup);

  // find restaurant for slug
  let slug = 'mi-local';
  if (backup.stores.restaurant && backup.stores.restaurant.length > 0) {
    const restaurant = backup.stores.restaurant[0] as Record<string, unknown>;
    if (typeof restaurant.slug === 'string' && restaurant.slug) {
      slug = restaurant.slug;
    }
  }

  const baseName = `fize-${slug}-datos-${backup.createdAt.slice(0, 10)}`;
  return { json, sql, baseName };
}

export async function exportMyData(kind: 'json' | 'sql'): Promise<void> {
  const files = await exportMyDataFiles();
  if (kind === 'json') {
    downloadText(files.json, `${files.baseName}.json`, 'application/json');
  } else {
    downloadText(files.sql, `${files.baseName}.sql`, 'application/sql');
  }
}
