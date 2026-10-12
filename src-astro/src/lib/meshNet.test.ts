import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveSignalingUrls, setSignalingUrls, clearSignalingUrls, isLocalMesh, isMeshEnabled } from './meshNet';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
});

describe('meshNet', () => {
  it('sin config NO hay señalización (malla apagada, sin servidor público)', () => {
    expect(resolveSignalingUrls()).toEqual([]);
    expect(isMeshEnabled()).toBe(false);
    expect(JSON.stringify(resolveSignalingUrls())).not.toMatch(/yjs\.dev|fly\.dev|peerjs/);
  });

  it('override explícito gana a todo', () => {
    setSignalingUrls(['ws://10.0.0.9:4444']);
    expect(resolveSignalingUrls(['ws://192.168.1.5:4444'])).toEqual(['ws://192.168.1.5:4444']);
  });

  it('stored persiste y se resuelve', () => {
    setSignalingUrls(['ws://192.168.1.5:4444']);
    expect(resolveSignalingUrls()).toEqual(['ws://192.168.1.5:4444']);
    expect(isLocalMesh()).toBe(true);
  });

  it('filtra esquemas inválidos y queda sin señalización', () => {
    expect(resolveSignalingUrls(['ftp://x', 'no-url'])).toEqual([]);
  });

  it('clear vuelve a malla apagada', () => {
    setSignalingUrls(['ws://192.168.1.5:4444']);
    clearSignalingUrls();
    expect(resolveSignalingUrls()).toEqual([]);
    expect(isLocalMesh()).toBe(false);
  });

  it('el bus no crea WebrtcProvider sin emparejar', async () => {
    const ctor = vi.fn();
    vi.resetModules();
    vi.doMock('y-webrtc', () => ({ WebrtcProvider: ctor }));
    const { meshPublish, resetMeshBus } = await import('./mesh');
    await meshPublish('t', { a: 1 });
    expect(ctor).not.toHaveBeenCalled();
    await resetMeshBus();
    vi.doUnmock('y-webrtc');
  });
});
