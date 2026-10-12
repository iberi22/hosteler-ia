import { describe, it, expect } from 'vitest';
import { selectStorageAdapter, describeSelected } from './storageRouter';
import { getMemoryAdapter } from './domain';

describe('storageRouter', () => {
  it('force selects each adapter kind', () => {
    expect(describeSelected(selectStorageAdapter({ force: 'memory' }))).toBe('memory');
    expect(describeSelected(selectStorageAdapter({ force: 'idb' }))).toBe('idb');
    expect(selectStorageAdapter({ force: 'memory' })).toBe(getMemoryAdapter());
  });

  it('force surreal requires edgeHiveUrl', () => {
    expect(() => selectStorageAdapter({ force: 'surreal' })).toThrow('edgeHiveUrl');
    expect(describeSelected(selectStorageAdapter({ force: 'surreal', edgeHiveUrl: 'https://edge.test' }))).toBe(
      'surreal',
    );
  });

  it('force vault requires env with bindings', () => {
    expect(() => selectStorageAdapter({ force: 'vault' })).toThrow('env required');
    expect(() => selectStorageAdapter({ force: 'vault', env: {} })).toThrow('bindings');
  });

  it('empty env falls through to memory in Node (no indexedDB)', () => {
    expect(describeSelected(selectStorageAdapter({ env: {} }))).toBe('memory');
    expect(describeSelected(selectStorageAdapter())).toBe('memory');
  });

  it('edgeHiveUrl wins over memory fallback', () => {
    expect(describeSelected(selectStorageAdapter({ edgeHiveUrl: 'https://edge.test' }))).toBe('surreal');
  });
});
