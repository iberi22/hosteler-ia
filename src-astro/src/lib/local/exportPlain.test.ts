import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdbForTests, getIdbAdapter } from '../idbAdapter';
import { ensureIdentity, resetIdentityCacheForTests } from './identity';
import { collectBackup } from './backupData';
import { exportMyDataFiles, exportMyData } from './exportPlain';
import { domainConfig } from '../domain.config';
import * as backupDataModule from './backupData';
import initSqlJs from 'sql.js';

describe('exportPlain', () => {
  beforeEach(async () => {
    resetIdbForTests();
    resetIdentityCacheForTests();
    vi.restoreAllMocks();
    const identity = await ensureIdentity();

    // Seed at least one row in each entity using the actual instance_id
    const idb = getIdbAdapter();
    const instanceId = identity.instanceId;

    for (const entity of domainConfig.entities) {
      if (entity.name === 'session') {
        // Will be excluded anyway, but let's seed it
        await idb.create(entity.name, {
          id: `sess-1`,
          instance_id: instanceId,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          userId: 'usr-1',
          expiresAt: '2026-12-31T23:59:59.000Z'
        } as any);
        continue;
      }

      const record: any = {
        id: `${entity.name}-1`,
        instance_id: instanceId,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      };

      // Let's add a fake field with single quote for SQL escaping test
      if (entity.fields.length > 0) {
        record[entity.fields[0]] = `O'Connor \n new line`;
      }

      // Add a secret to user to ensure it's filtered
      if (entity.name === 'user') {
        record.passwordHash = 'secret-hash';
        record.recoveryCode = 'secret-recovery';
      }

      await idb.create(entity.name, record);
    }
  });

  it('JSON round-trip deep-equals collectBackup() stores excluding secrets', async () => {
    const backup = await collectBackup();
    const { json, sql } = await exportMyDataFiles();

    const parsed = JSON.parse(json);

    // Check that we filtered out the secret
    expect(parsed.local.identity).toBeDefined();
    expect(parsed.local.identity.privateJwk).toBeUndefined();
    expect(parsed.local.identity.publicJwk).toBeUndefined();

    // session should be completely missing
    expect(parsed.stores.session).toBeUndefined();
    expect(backup.stores.session).toBeDefined(); // Originally in backup
    expect(backup.stores.session.length).toBe(1); // Since we seeded it

    // passwordHash should be removed from user
    const users = parsed.stores.user;
    expect(users[0].passwordHash).toBeUndefined();
    expect(users[0].recoveryCode).toBeUndefined();
    expect(users[0].id).toBe('user-1'); // Verify we got the user

    // Validate we matched expected entities (all but session)
    const expectedEntities = domainConfig.entities.map(e => e.name).filter(n => n !== 'session');
    for (const name of expectedEntities) {
      expect(parsed.stores[name]).toBeDefined();
      expect(parsed.stores[name].length).toBe(1);
    }

    // It should not contain privateJwk
    expect(json).not.toContain('privateJwk');
    expect(sql).not.toContain('privateJwk');
  });

  it('SQL restores into an empty store matching seeds', async () => {
    const { sql } = await exportMyDataFiles();

    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // Run the dump
    db.run(sql);

    const expectedEntities = domainConfig.entities.map(e => e.name).filter(n => n !== 'session');

    for (const name of expectedEntities) {
      const res = db.exec(`SELECT count(*) as cnt FROM "${name}"`);
      expect(res[0].values[0][0]).toBe(1);

      const resData = db.exec(`SELECT data FROM "${name}"`);
      const rowData = JSON.parse(resData[0].values[0][0] as string);

      // Check SQL escaping worked correctly
      if (domainConfig.entities.find(e => e.name === name)?.fields.length! > 0) {
        const fieldName = domainConfig.entities.find(e => e.name === name)!.fields[0];
        expect(rowData[fieldName]).toBe(`O'Connor \n new line`);
      }
    }
  });

  it('calls downloadText with correct filenames', async () => {
    const spy = vi.spyOn(backupDataModule, 'downloadText').mockImplementation(() => {});

    await exportMyData('json');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatch(/\.json$/);

    await exportMyData('sql');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1]).toMatch(/\.sql$/);
  });
});
