<script lang="ts">
  // RegisterForm.svelte — Svelte 5 runes, posts to /api/auth/register
  import { authErrorMessage } from '../../lib/authMessages';

  interface Props {
    title?: string;
    nameLabel?: string;
    emailLabel?: string;
    passwordLabel?: string;
    submitLabel?: string;
    loginHint?: string;
    loginHref?: string;
    contactHref?: string;
  }

  let {
    title = 'Crear cuenta en Fi’ze',
    nameLabel = 'Nombre',
    emailLabel = 'Correo',
    passwordLabel = 'Contraseña (mín. 8)',
    submitLabel = 'Registrarme',
    loginHint = '¿Ya tienes cuenta?',
    loginHref = '/login',
    contactHref = '',
  }: Props = $props();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let errorStatus = $state(0);
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    errorStatus = 0;
    loading = true;
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        errorStatus = res.status;
        error = authErrorMessage('register', res.status);
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      error = authErrorMessage('register', 0);
    } finally {
      loading = false;
    }
  }
</script>

<form class="auth-form" onsubmit={submit}>
  <h1>{title}</h1>
  <p class="hint">
    El acceso a Fize es por invitación: lo activamos contigo al montar tu restaurante.
    {#if contactHref}<a href={contactHref}>Escríbenos</a> y te acompañamos.{/if}
  </p>
  <label>
    {nameLabel}
    <input type="text" bind:value={name} required autocomplete="name" />
  </label>
  <label>
    {emailLabel}
    <input type="email" bind:value={email} required autocomplete="email" />
  </label>
  <label>
    {passwordLabel}
    <input type="password" bind:value={password} required minlength={8} autocomplete="new-password" />
  </label>
  {#if error}
    <p class="error" role="alert">
      {error}
      {#if errorStatus === 409}<a href={loginHref}>Entrar</a>{/if}
    </p>
  {/if}
  <button type="submit" disabled={loading}>{loading ? '…' : submitLabel}</button>
  <p class="hint">{loginHint} <a href={loginHref}>Entra</a></p>
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
  .error a { color: inherit; }
  .hint a { color: var(--swal-accent, #06b6d4); }
</style>
