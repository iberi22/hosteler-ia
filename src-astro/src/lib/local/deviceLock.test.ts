
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { lock, unlock, getLockState, enableProtection, disableProtection, changePin, LockedError, resetDeviceLockForTests } from './deviceLock';
import { resetLocalDbForTests, deleteLocal } from './localDb';

// mock crypto to be fast
vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (algo: any, baseKey, derivedKeyType, extractable, keyUsages) => {
  if (algo.name === 'PBKDF2') algo.iterations = 1;
  return (crypto.subtle as any).constructor.prototype.deriveKey.call(crypto.subtle, algo, baseKey, derivedKeyType, extractable, keyUsages);
});

describe('deviceLock', () => {
  beforeEach(async () => {
        resetLocalDbForTests();
    await deleteLocal('lockEnvelope');
    resetDeviceLockForTests();
  });

  it('initial state is off', async () => {
    expect(await getLockState()).toBe('off');
  });

  it('enables protection, locks and unlocks with PIN', async () => {
    const code = await enableProtection('pin', '123456');
    expect(await getLockState()).toBe('unlocked');
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    lock();
    expect(await getLockState()).toBe('locked');

    await expect(unlock('pin', '654321')).rejects.toThrow(LockedError);
    expect(await getLockState()).toBe('locked');

    await unlock('pin', '123456');
    expect(await getLockState()).toBe('unlocked');
  });

  it('unlocks with recovery code', async () => {
    const code = await enableProtection('pin', '123456');
    lock();

    await unlock('recovery', code);
    expect(await getLockState()).toBe('unlocked');
  });

  it('changes PIN', async () => {
    await enableProtection('pin', '123456');
    await changePin('123456', '654321');

    lock();
    await expect(unlock('pin', '123456')).rejects.toThrow();
    await unlock('pin', '654321');
    expect(await getLockState()).toBe('unlocked');
  });

  it('disables protection', async () => {
    await enableProtection('pin', '123456');
    await disableProtection();
    resetDeviceLockForTests();

    expect(await getLockState()).toBe('off');
  });
});
