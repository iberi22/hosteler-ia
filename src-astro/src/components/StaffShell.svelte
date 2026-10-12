<script lang="ts">
  // StaffShell.svelte — AppShell del core + "Cerrar sesion" del panel.
  // Astro no puede pasar snippets a un componente Svelte, asi que el boton vive
  // aqui: en la barra lateral (escritorio) y en una barra superior (movil, donde
  // el pie lateral se oculta).
  import type { Snippet } from 'svelte';
  import { AppShell } from '@swal/ui';

  interface NavItem {
    href: string;
    label: string;
    icon?: string;
  }

  interface Props {
    items?: NavItem[];
    currentPath?: string;
    showNav?: boolean;
    menuLabel?: string;
    style?: string;
    children?: Snippet;
  }

  let { items = [], currentPath = '/', showNav = false, menuLabel = 'Menú', style = '', children }: Props = $props();

  let leaving = $state(false);
  let failed = $state(false);

  async function logout() {
    leaving = true;
    failed = false;
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.href = '/login';
    } catch {
      failed = true;
      leaving = false;
    }
  }
</script>

{#snippet logoutButton(where: string)}
  <button type="button" class="logout logout-{where}" onclick={logout} disabled={leaving}>
    {leaving ? 'Saliendo…' : 'Cerrar sesión'}
  </button>
  {#if failed}<p class="logout-error" role="alert">No se pudo cerrar la sesión. Inténtalo de nuevo.</p>{/if}
{/snippet}

{#snippet navFooter()}
  {@render logoutButton('side')}
{/snippet}

{#snippet topbar()}
  {@render logoutButton('top')}
{/snippet}

<AppShell
  {items}
  {currentPath}
  {showNav}
  {menuLabel}
  {style}
  navFooter={showNav ? navFooter : undefined}
  topbar={showNav ? topbar : undefined}
>
  {@render children?.()}
</AppShell>

<style>
  .logout {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--swal-border);
    background: transparent;
    color: var(--swal-text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .logout-top { width: auto; }
  .logout:disabled { opacity: 0.6; cursor: wait; }
  .logout-error { color: var(--swal-danger); font-size: 0.85rem; margin-top: 0.5rem; }

  /* La barra superior es solo para movil: en escritorio el boton va en la lateral. */
  @media (min-width: 769px) {
    :global(.swal-app-shell > .main-area > .topbar) { display: none; }
  }
</style>
