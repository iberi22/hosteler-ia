// authMessages.ts — errores de login y registro en espanol, por codigo HTTP.
// La API responde en ingles ("Invalid credentials"); el comensal o el dueno
// nunca deben verlo. El mapeo es del cliente y se decide solo por el estado.

export type AuthKind = 'login' | 'register';

const NETWORK = 'Sin conexión. Revisa tu internet y vuelve a intentarlo.';
const SERVER = 'Algo falló de nuestro lado. Inténtalo de nuevo en unos minutos.';
const TOO_MANY = 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';

export function authErrorMessage(kind: AuthKind, status: number): string {
  if (status === 0) return NETWORK;
  if (status === 429) return TOO_MANY;
  if (status >= 500) return SERVER;
  switch (status) {
    case 400:
      return kind === 'login'
        ? 'Revisa tu correo y tu contraseña.'
        : 'Revisa los datos: el correo debe ser válido y la contraseña tener al menos 8 caracteres.';
    case 401:
      return 'Correo o contraseña incorrectos.';
    case 403:
      return kind === 'register'
        ? 'El registro está cerrado. Pídele acceso al dueño del restaurante.'
        : 'No tienes acceso. Pídele acceso al dueño del restaurante.';
    case 409:
      return 'Ese correo ya tiene cuenta.';
    default:
      return 'No se pudo completar la solicitud. Inténtalo de nuevo.';
  }
}
