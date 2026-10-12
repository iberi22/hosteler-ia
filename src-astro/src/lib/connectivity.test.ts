import { describe, it, expect } from 'vitest';
import { queueMessage, shouldShowBanner } from './connectivity';

describe('connectivity banner copy', () => {
  it('hides when online with empty queues', () => {
    expect(queueMessage(0, 0, true)).toBe('');
    expect(shouldShowBanner(0, 0, true)).toBe(false);
  });

  it('warns offline even with empty queues', () => {
    expect(queueMessage(0, 0, false)).toContain('Sin conexión');
    expect(shouldShowBanner(0, 0, false)).toBe(true);
  });

  it('counts both queues when pending', () => {
    expect(queueMessage(2, 3, false)).toContain('5');
    expect(queueMessage(1, 0, true)).toContain('Sincronizando');
  });
});
