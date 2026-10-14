import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import initSqlJs from 'sql.js';
import { buildPlainJson, buildSqlDump, exportMyDataFiles, exportMyData } from './exportPlain';
import { ensureIdentity, resetIdentityCacheForTests } from './identity';
import { setLocal } from './localDb';
import { resetIdbForTests, getIdbAdapter } from '../idbAdapter';
import { domainConfig } from '../domain.config';
import * as backupData from './backupData';

describe('exportPlain', () => {
  beforeEach(async () => {
    resetIdentityCacheForTests();
    resetIdbForTests();
    await ensureIdentity();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildPlainJson strips secrets and preserves entities (except session)', async () => {
    const adapter = getIdbAdapter();
    const identity = await ensureIdentity();
    const instanceId = identity.instanceId;

    // Seed dummy data for each entity
    for (const entity of domainConfig.entities) {
      await adapter.create(entity.name, {
        id: `test-${entity.name}-1`,
        instance_id: instanceId,
        test_field: "value with ' quote and \n newline",
      } as any);
    }

    await setLocal('recoveryCode', 'ABCD-1234');
    await setLocal('onboarding', { step: 1 });
    await setLocal('settings', { theme: 'dark' });

    const { json, baseName } = await exportMyDataFiles();
    const parsed = JSON.parse(json);

    expect(baseName).toMatch(/^fize-mi-local-datos-\d{4}-\d{2}-\d{2}$/);

    // Check stripped secrets
    expect(json).not.toContain('privateJwk');
    expect(json).not.toContain('ABCD-1234');

    // Check stripped session
    expect(json).not.toContain('test-session-1');
    expect(parsed.stores.session).toBeUndefined();

    // Check preserved entities
    const expectedEntities = domainConfig.entities.filter(e => e.name !== 'session').map(e => e.name);
    for (const name of expectedEntities) {
      expect(parsed.stores[name]).toBeDefined();
      expect(parsed.stores[name].length).toBe(1);
      expect(parsed.stores[name][0].id).toBe(`test-${name}-1`);
      expect(parsed.stores[name][0].test_field).toBe("value with ' quote and \n newline");
    }

    expect(parsed.local.onboarding).toEqual({ step: 1 });
    expect(parsed.local.settings).toEqual({ theme: 'dark' });
    expect(parsed.local.identity.instanceId).toBe(instanceId);
    expect(parsed.local.identity.privateJwk).toBeUndefined();
  });

  it('buildSqlDump builds valid SQLite dump', async () => {
    const adapter = getIdbAdapter();
    const identity = await ensureIdentity();
    const instanceId = identity.instanceId;

    for (const entity of domainConfig.entities) {
      await adapter.create(entity.name, {
        id: `test-${entity.name}-1`,
        instance_id: instanceId,
        test_field: "value with ' quote and \n newline",
      } as any);
    }

    const { sql } = await exportMyDataFiles();

    expect(sql).not.toContain('privateJwk');
    expect(sql).not.toContain('test-session-1');

    const SQL = await initSqlJs();
    const db = new SQL.Database();

    db.run(sql);

    const metaCount = db.exec('SELECT count(*) FROM _export_meta')[0].values[0][0];
    expect(metaCount).toBe(4);

    const expectedEntities = domainConfig.entities.filter(e => e.name !== 'session').map(e => e.name);
    for (const name of expectedEntities) {
      const count = db.exec(`SELECT count(*) FROM "${name}"`)[0].values[0][0];
      expect(count).toBe(1);
    }
  });

  it('exportMyData calls downloadText with correct params', async () => {
    const downloadSpy = vi.spyOn(backupData, 'downloadText').mockImplementation(() => {});

    await exportMyData('json');
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy.mock.calls[0][1]).toMatch(/\.json$/);
    expect(downloadSpy.mock.calls[0][2]).toBe('application/json');

    await exportMyData('sql');
    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(downloadSpy.mock.calls[1][1]).toMatch(/\.sql$/);
    expect(downloadSpy.mock.calls[1][2]).toBe('application/sql');
  });
});
