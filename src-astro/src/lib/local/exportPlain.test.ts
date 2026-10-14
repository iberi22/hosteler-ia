import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { ensureIdentity, loadIdentity } from './identity';
import { getIdbAdapter, resetIdbForTests } from '../idbAdapter';
import { domainConfig } from '../domain.config';
import { exportMyDataFiles, exportMyData } from './exportPlain';
import * as backupData from './backupData';

describe('exportPlain', () => {
  beforeEach(async () => {
    resetIdbForTests();
    await ensureIdentity();
  });

  it('JSON round trip', async () => {
    const identity = await loadIdentity();
    const instanceId = identity!.instanceId;
    const storage = getIdbAdapter();

    // seed
    for (const e of domainConfig.entities) {
      await storage.create(e.name, {
        id: `id-${e.name}`,
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        name: `test ${e.name} with ' single quote`,
      });
    }

    const { json } = await exportMyDataFiles();
    const parsed = JSON.parse(json);

    const originalBackup = await backupData.collectBackup();

    expect(parsed.stores).toEqual(originalBackup.stores);
    // ensure 14 entities are exported
    expect(Object.keys(parsed.stores).length).toBe(14);
  });

  it('SQL restores into empty store correctly', async () => {
    const identity = await loadIdentity();
    const instanceId = identity!.instanceId;
    const storage = getIdbAdapter();

    // seed
    for (const e of domainConfig.entities) {
      await storage.create(e.name, {
        id: `id-${e.name}`,
        instance_id: instanceId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        name: `test ${e.name} with ' single quote and \n newline`,
      });
    }

    const { sql } = await exportMyDataFiles();

    // load into sqlite
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    db.run(sql);

    for (const e of domainConfig.entities) {
      const res = db.exec(`SELECT count(*) as count FROM "${e.name}"`);
      expect(res[0].values[0][0]).toBe(1);
    }

    // Verify a row content
    const res = db.exec(`SELECT data FROM "restaurant"`);
    const dataStr = res[0].values[0][0] as string;
    const parsedData = JSON.parse(dataStr);
    expect(parsedData.name).toBe("test restaurant with ' single quote and \n newline");
  });

  it('strips secrets', async () => {
    const { json, sql } = await exportMyDataFiles();
    expect(json).not.toContain('privateJwk');
    expect(sql).not.toContain('privateJwk');
    expect(json).not.toContain('publicJwk');
    expect(sql).not.toContain('publicJwk');
    expect(json).not.toContain('recoveryCode');
    expect(sql).not.toContain('recoveryCode');
  });

  it('exportMyData calls downloadText with correct arguments', async () => {
    const downloadSpy = vi.spyOn(backupData, 'downloadText').mockImplementation(() => {});

    await exportMyData('json');
    expect(downloadSpy).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/\.json$/), 'application/json');

    await exportMyData('sql');
    expect(downloadSpy).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/\.sql$/), 'application/sql');

    downloadSpy.mockRestore();
  });
});
