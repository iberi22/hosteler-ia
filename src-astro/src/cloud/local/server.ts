// local/server.ts — modulo cloud por defecto (sin nube): ninguna ruta cloud existe.
// Las rutas delegadoras de src/pages/api responden 404 `{ error: 'cloud disabled' }` (ver ../index.ts).
import type { CloudServer } from '../types';

export const cloudServer: CloudServer = {
  enabled: false,
  routes: {},
};
