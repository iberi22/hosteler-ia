// local/client.ts — modulo cloud por defecto (sin nube) para las islas del navegador.
// Sin planes, creditos ni consumo: la UI esconde esas secciones. (El registro manual de cobros es de la
// app publica: src/lib/payments.ts.)
import type { CloudClient } from '../types';

export const cloudClient: CloudClient = {
  enabled: false,
  billing: null,
  plan: null,
  usage: null,
};
