import { describe, it, expect } from 'vitest';
import { requireRole } from './requireRole';
import { AuthError } from './session';

const locals = (role: string) => ({ user: { userId: 'u1', email: 'a@b.c', name: 'A', role } }) as unknown as App.Locals;

describe('requireRole', () => {
  it('lets the owner through', () => {
    expect(requireRole(locals('owner'), ['owner']).role).toBe('owner');
  });

  it('rejects staff with 403 on an owner-only write', () => {
    try {
      requireRole(locals('staff'), ['owner']);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(403);
    }
  });

  it('rejects an anonymous request with 401', () => {
    try {
      requireRole(undefined, ['owner']);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as AuthError).status).toBe(401);
    }
  });
});
