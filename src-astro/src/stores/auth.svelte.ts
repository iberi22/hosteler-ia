// auth.svelte.ts — Svelte 5 runes (migración Zustand → $state) H1.08
// Canon: Zustand auth-store.ts → runes, sin supabase en src-astro (usa Xavier/instance_id)
export type AuthUser = { id: string; email: string; name?: string };
export type AuthProfile = { id: string; restaurant_id: string; role: string; restaurant: { id: string; name: string } };

export const auth = $state<{ user: AuthUser | null; session: null; profile: AuthProfile | null; isAuthenticated: boolean; isLoading: boolean; isInitialized: boolean }>({
  user: null,
  session: null,
  profile: null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,
});

export async function initializeAuth() {
  if (typeof window === 'undefined') return;
  // DEMO bypass — mock como en src/stores/auth-store.ts
  const mockUser: AuthUser = { id: 'demo-user-001', email: 'demo@fize.app', name: 'Demo User' };
  const mockProfile: AuthProfile = { id: 'demo-owner-id', restaurant_id: 'demo-restaurant-id', role: 'owner', restaurant: { id: 'demo-restaurant-id', name: 'El Sazón Demo' } };
  auth.user = mockUser;
  auth.profile = mockProfile;
  auth.isAuthenticated = true;
  auth.isInitialized = true;
}

export function setUser(u: AuthUser | null) { auth.user = u; auth.isAuthenticated = !!u; }
export function setProfile(p: AuthProfile | null) { auth.profile = p; }
export function setLoading(v: boolean) { auth.isLoading = v; }
export async function signOut() { auth.user = null; auth.profile = null; auth.isAuthenticated = false; }

// --- Wave-H2.12: wire a sesión Lucia (/api/auth/me, FASE 4) con fallback demo ---
import { mapSession } from '../lib/storeSync';

export async function refreshSession(fetchFn: typeof fetch = fetch) {
  setLoading(true);
  try {
    const res = await fetchFn('/api/auth/me');
    if (!res.ok) {
      await initializeAuth(); // fallback demo hasta FASE 4
      return;
    }
    const { user, profile } = mapSession((await res.json()) as Record<string, unknown>);
    auth.user = user;
    auth.profile = profile;
    auth.isAuthenticated = !!user;
    auth.isInitialized = true;
  } finally {
    setLoading(false);
  }
}
