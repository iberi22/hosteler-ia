import { describe, it, expect } from 'vitest';
import { meshNamespace, parseMeshNamespace, namespacesAreIsolated } from './meshNs';

describe('meshNs (conformidad con edge-mesh)', () => {
  it('builds swal/{app}/{instance}', () => {
    expect(meshNamespace('hosteler-ia', 'default')).toBe('swal/hosteler-ia/default');
  });

  it('rejects empty segments and slashes (igual que el core)', () => {
    expect(() => meshNamespace('', 'x')).toThrow();
    expect(() => meshNamespace('a', '')).toThrow();
    expect(() => meshNamespace('a/b', 'x')).toThrow();
    expect(() => meshNamespace('a', 'x/y')).toThrow();
  });

  it('parses valid namespaces, null on garbage', () => {
    expect(parseMeshNamespace('swal/hosteler-ia/default')).toEqual({ appId: 'hosteler-ia', instanceId: 'default' });
    expect(parseMeshNamespace('swal//default')).toBeNull();
    expect(parseMeshNamespace('http://x')).toBeNull();
    expect(parseMeshNamespace('swal/a/b/c')).toBeNull();
  });

  it('isolation matches core semantics', () => {
    expect(namespacesAreIsolated('swal/a/1', 'swal/a/1')).toBe(false);
    expect(namespacesAreIsolated('swal/a/1', 'swal/a/2')).toBe(true);
    expect(namespacesAreIsolated('swal/a/1', 'swal/b/1')).toBe(true);
  });
});
