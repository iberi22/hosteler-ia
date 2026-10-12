// cloud/client.ts — frontera del modulo cloud para las islas del navegador.
// Mismo alias que ./index.ts (ver cloud.config.mjs). Cada capacidad es `null` si el modulo no esta.
import { cloudClient as impl } from '@fize/cloud-impl/client';
import type { CloudClient } from './types';

export type * from './types';

export const cloudClient: CloudClient = impl;
