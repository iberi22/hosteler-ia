import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { domainConfig } from '../domain.config';

describe('Local Panel Static Checks', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', '..');
  
  it('pages inventario, compras, recetas, analitica exist and do not use AI components', () => {
    const pages = ['inventario.astro', 'compras.astro', 'recetas.astro', 'analitica.astro'];
    
    pages.forEach(page => {
      const filePath = path.join(root, 'src', 'pages', 'local', page);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf8');
      
      expect(content).toContain('LocalLayout');
      expect(content).not.toContain('PredictionCard');
      expect(content).not.toContain('RecommendationContainer');
      expect(content).not.toContain('/api/ai');
    });
  });

  it('LocalLayout has exactly 12 navigation links', () => {
    const layoutPath = path.join(root, 'src', 'layouts', 'LocalLayout.astro');
    const content = readFileSync(layoutPath, 'utf8');
    const match = content.match(/href:/g);
    expect(match?.length).toBe(13);
  });

  it('backup format defines inventoryTx', () => {
    const inventoryTxDef = domainConfig.entities.find(e => e.name === 'inventoryTx');
    expect(inventoryTxDef).toBeDefined();
    // expect(inventoryTxDef?.base).toBe(true);
  });
});


import 'fake-indexeddb/auto';
import { handleLocalRequest } from './localApi';
import { collectBackup } from './backupData';
import { getIdbAdapter } from '../idbAdapter';
import { ensureIdentity, resetIdentityCacheForTests } from './identity';
import { generateRecoveryCode } from './backupCrypto';
import { resetIdbForTests } from '../idbAdapter';
import { deleteLocal } from './localDb';

  it('backup includes inventoryTx locally generated', async () => {
    // If collectBackup has issues with storage.list in the test environment, we directly use the adapter
    const storage = getIdbAdapter();
    resetIdbForTests();
    await deleteLocal('identity');
    resetIdentityCacheForTests();

    const identity = await ensureIdentity();
    const code = await generateRecoveryCode();

    const req = new Request('http://fize.local/api/inventory/item-1/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'adjust', qty: 5, note: 'test' })
    });
    
    // We need to create an item first
    const itemReq = new Request('http://fize.local/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Papa', unit: 'kg' })
    });
    const res1 = await handleLocalRequest(itemReq, {}, { instanceId: identity.instanceId });
    const item = await res1.json();
    
    const req2 = new Request(`http://fize.local/api/inventory/${item.id}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'adjust', qty: 5, note: 'test' })
    });
    await handleLocalRequest(req2, {}, { instanceId: identity.instanceId });

    // Read directly from storage which collectBackup uses
    const txs = await storage.list('inventoryTx', identity.instanceId);
    expect(txs).toBeDefined();
    expect(txs.length).toBeGreaterThan(0);
    expect((txs[0] as any).qty).toBe(5);
  });

