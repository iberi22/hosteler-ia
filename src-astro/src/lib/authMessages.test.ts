import { describe, expect, it } from 'vitest';
import { authErrorMessage } from './authMessages';

describe('authErrorMessage', () => {
  it('login: 401 es credenciales incorrectas y 429 demasiados intentos', () => {
    expect(authErrorMessage('login', 401)).toBe('Correo o contraseña incorrectos.');
    expect(authErrorMessage('login', 429)).toMatch(/Demasiados intentos/);
  });

  it('registro: 403 cerrado y 409 correo existente', () => {
    expect(authErrorMessage('register', 403)).toMatch(/registro está cerrado/);
    expect(authErrorMessage('register', 409)).toBe('Ese correo ya tiene cuenta.');
  });

  it('5xx y red tienen mensaje propio en espanol', () => {
    expect(authErrorMessage('login', 503)).toMatch(/de nuestro lado/);
    expect(authErrorMessage('register', 0)).toMatch(/Sin conexión/);
  });

  it('ningun mensaje esta en ingles', () => {
    for (const kind of ['login', 'register'] as const) {
      for (const s of [0, 400, 401, 403, 404, 409, 429, 500]) {
        expect(authErrorMessage(kind, s)).not.toMatch(/Invalid|closed|already|Too many|error/i);
      }
    }
  });
});
