// onboarding.ts — avance del onboarding del modo local (NODO-LOCAL.md §4). Vive en `fize-local` y viaja en
// la copia cifrada, asi que restaurar en un equipo nuevo no vuelve a pedir el onboarding.
import { getLocal } from './localDb';

export const ONBOARDING_STEPS = 6;

export interface OnboardingState {
  step: number;
  completed: boolean;
  restaurantId?: string;
  recoveryConfirmed?: boolean;
  phase5?: 'carta' | 'publicar';
  startedAt: string;
  completedAt?: string;
}

export async function loadOnboarding(): Promise<OnboardingState> {
  const saved = await getLocal<OnboardingState>('onboarding');
  if (saved && typeof saved.step === 'number') {
    return { ...saved, step: Math.min(Math.max(1, Math.floor(saved.step)), ONBOARDING_STEPS) };
  }
  return { step: 1, completed: false, startedAt: new Date().toISOString() };
}
