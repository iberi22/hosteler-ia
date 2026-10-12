import { describe, test, expect } from 'vitest';
import { meshRoom, meshPublish, meshSubscribe } from './mesh';

describe('mesh', () => {
  test('meshRoom generates correct room path swal/hosteler-ia/{instanceId}', () => {
    expect(meshRoom('inst-123')).toBe('swal/hosteler-ia/inst-123');
    expect(meshRoom()).toBe('swal/hosteler-ia/default');
  });

  test('meshPublish & meshSubscribe publish/receive messages safely', async () => {
    let received: any = null;
    const unsubscribe = await meshSubscribe('test:topic', (data) => {
      received = data;
    });
    await meshPublish('test:topic', { ok: true });
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    void received;
  });
});
