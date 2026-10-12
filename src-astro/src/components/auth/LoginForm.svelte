<script lang="ts">
  // LoginForm.svelte — Svelte 5 runes, posts to /api/auth/login
  import { authErrorMessage } from '../../lib/authMessages';

  interface Props {
  title?: string;
  emailLabel?: string;
  passwordLabel?: string;
  submitLabel?: string;
  contactHref?: string;
}

let {
  title = 'Entrar a Fi’ze',
  emailLabel = 'Correo',
  passwordLabel = 'Contraseña',
  submitLabel = 'Entrar',
  contactHref = '',
}: Props = $props();

let email = $state('');
let password = $state('');
let error = $state('');
let loading = $state(false);

async function submit(event: SubmitEvent) {
  event.preventDefault();
  error = '';
  loading = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      error = authErrorMessage('login', res.status);
      return;
    }
    window.location.href = '/dashboard';
  } catch {
    error = authErrorMessage('login', 0);
  } finally {
    loading = false;
  }
}
</script>

<form class="auth-form" onsubmit={submit}>
  <h1>{title}</h1>
  <label>
    {emailLabel}
    <input type="email" bind:value={email} required autocomplete="email" />
  </label>
  <label>
    {passwordLabel}
    <input type="password" bind:value={password} required autocomplete="current-password" />
  </label>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <button type="submit" disabled={loading}>{loading ? '…' : submitLabel}</button>
  {#if contactHref}
    <p class="hint"><a href={contactHref}>¿Olvidaste tu contraseña? Escríbenos</a></p>
  {/if}
  <p class="hint">¿Eres del equipo? Pídele acceso al dueño del restaurante.</p>
  {#if contactHref}
    <p class="hint">¿Tu restaurante aún no usa Fize? <a href={contactHref}>Escríbenos</a></p>
  {/if}
</form>

<style>
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 22rem;
    margin: 4rem auto;
    padding: 2rem;
    border: 1px solid var(--swal-border, #1e293b);
    border-radius: 0.75rem;
    background: var(--swal-surface, #0f0f10);
  }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
  input {
    padding: 0.6rem;
    border-radius: 0.5rem;
    border: 1px solid var(--swal-border, #1e293b);
    background: var(--swal-bg, #050507);
    color: inherit;
  }
  button {
    padding: 0.7rem;
    border-radius: 0.5rem;
    border: none;
    cursor: pointer;
    background: var(--swal-accent, #06b6d4);
    color: var(--swal-bg);
    font-weight: 600;
  }
  button:disabled { opacity: 0.6; cursor: wait; }
  .error { color: var(--swal-danger); font-size: 0.9rem; }
  .hint { font-size: 0.85rem; opacity: 0.8; }
  .hint a { color: var(--swal-accent, #06b6d4); }
</style>
