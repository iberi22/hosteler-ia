<!-- NotificationCenter.svelte — bandeja de avisos del panel (read/unread).
     El legacy lo tenia en un panel de React sobre Supabase; aqui son las reglas
     de src/lib/notifications.ts y nada de Supabase. El componente no decide
     nada: filtra lo que el servidor ya filtro por sesion. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Card, Badge } from '@swal/ui';
  import { api } from '../../lib/api-client';
  import type { Notification } from '../../lib/notifications';

  let items = $state<Notification[]>([]);
  let unread = $state(0);
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let onlyUnread = $state(false);
  let busyId = $state<string | null>(null);

  async function load() {
    isLoading = true;
    error = null;
    try {
      const url = onlyUnread ? '/api/notifications?isRead=false' : '/api/notifications';
      const res = await api.get(url);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = (await res.json()) as { notifications: Notification[]; unreadCount: number };
      items = body.notifications;
      unread = body.unreadCount;
    } catch {
      error = 'No se pudieron cargar los avisos.';
    } finally {
      isLoading = false;
    }
  }

  // El toggle de "solo no leidos" refetch: el filtro es del servidor, no un
  // slice en el cliente, para que el conteo del badge siga siendo el real.
  function toggleUnread() {
    onlyUnread = !onlyUnread;
    void load();
  }

  async function markRead(n: Notification) {
    busyId = n.id;
    try {
      // PATCH, no POST: el toggle va a /api/notifications/:id. El POST de la
      // coleccion es para crear avisos.
      const res = await fetch(`/api/notifications/${n.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: !n.isRead }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await load();
    } catch {
      error = 'No se pudo actualizar el aviso.';
    } finally {
      busyId = null;
    }
  }

  async function dismiss(n: Notification) {
    busyId = n.id;
    try {
      const res = await api.del(`/api/notifications/${n.id}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await load();
    } catch {
      error = 'No se pudo descartar el aviso.';
    } finally {
      busyId = null;
    }
  }

  async function markAllRead() {
    try {
      const res = await fetch('/api/notifications?all=true', { method: 'PATCH' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await load();
    } catch {
      error = 'No se pudieron marcar todos como leidos.';
    }
  }

  function typeVariant(type: Notification['type']): 'danger' | 'warning' | 'success' | 'info' {
    if (type === 'error') return 'danger';
    if (type === 'warning') return 'warning';
    if (type === 'success') return 'success';
    return 'info';
  }

  function typeIcon(type: Notification['type']): string {
    if (type === 'error') return '✕';
    if (type === 'warning') return '!';
    if (type === 'success') return '✓';
    return 'i';
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('es-CO', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  onMount(load);
</script>

<Card variant="default" padding="none">
  <div class="header">
    <div class="title-row">
      <h3 class="title">Avisos</h3>
      {#if unread > 0}
        <Badge variant="warning" size="sm">{unread} sin leer</Badge>
      {/if}
    </div>
    <div class="actions">
      <Button variant="ghost" size="sm" onclick={toggleUnread}>
        {onlyUnread ? 'Ver todos' : 'Solo sin leer'}
      </Button>
      {#if unread > 0}
        <Button variant="ghost" size="sm" onclick={markAllRead}>Marcar leidos</Button>
      {/if}
      <Button variant="ghost" size="sm" onclick={load}>Recargar</Button>
    </div>
  </div>

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  {#if isLoading}
    <div class="empty" aria-busy="true">Cargando avisos…</div>
  {:else if items.length === 0}
    <div class="empty">
      <span class="empty-icon" aria-hidden="true">◉</span>
      <span>{onlyUnread ? 'Nada sin leer — todo al dia' : 'Sin avisos'}</span>
    </div>
  {:else}
    <ul class="list" role="list">
      {#each items as n (n.id)}
        <li class="item" class:unread={!n.isRead} role="listitem">
          <span class="icon {n.type}" aria-hidden="true">{typeIcon(n.type)}</span>
          <div class="body">
            <div class="row-title">
              <span class="item-title">{n.title}</span>
              <Badge variant={typeVariant(n.type)} size="sm">{n.type}</Badge>
              {#if n.priority === 'critical' || n.priority === 'high'}
                <Badge variant="danger" size="sm">{n.priority}</Badge>
              {/if}
            </div>
            <p class="item-message">{n.message}</p>
            <div class="meta">
              <span>{fmtDate(n.created_at)}</span>
              {#if n.isRead && n.readAt}
                <span>· leido {fmtDate(n.readAt)}</span>
              {/if}
            </div>
          </div>
          <div class="item-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === n.id}
              onclick={() => markRead(n)}
            >
              {n.isRead ? 'Marcar no leido' : 'Marcar leido'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === n.id}
              onclick={() => dismiss(n)}
            >
              Descartar
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</Card>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.08));
  }

  .title-row { display: flex; align-items: center; gap: 0.5rem; }

  .title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .actions { display: flex; gap: 0.375rem; flex-wrap: wrap; }

  .error {
    padding: 0.625rem 1rem;
    color: var(--swal-danger, #f87171);
    font-size: 0.8125rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.06));
  }

  .empty {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1.5rem 1rem;
    color: var(--swal-text-secondary, #64748b);
    font-size: 0.875rem;
  }

  .empty-icon { color: var(--swal-accent-cyan, #22d3ee); }

  .list { list-style: none; margin: 0; padding: 0; }

  .item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .item:last-child { border-bottom: none; }

  /* Lo no leido se marca con una banda a la izquierda. El color por si solo
     seria insuficiente: tambien es la unica senal que sobrevive a un tema claro
     y a un daltonismo rojo/verde. */
  .item.unread { border-left: 2px solid var(--swal-accent-cyan, #22d3ee); }
  .item:not(.unread) { opacity: 0.72; }

  .icon {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 9999px;
    display: grid;
    place-items: center;
    font-size: 0.6875rem;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 0.125rem;
    border: 1px solid currentColor;
  }

  .icon.info { color: var(--swal-accent-cyan, #22d3ee); }
  .icon.warning { color: var(--swal-warning, #fbbf24); }
  .icon.error { color: var(--swal-danger, #f87171); }
  .icon.success { color: var(--swal-neon-green, #4ade80); }

  .body { flex: 1; min-width: 0; }

  .row-title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .item-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--swal-text, #e2e8f0);
  }

  .item-message {
    margin: 0.125rem 0 0;
    font-size: 0.8125rem;
    color: var(--swal-text-secondary, #94a3b8);
  }

  .meta {
    margin-top: 0.25rem;
    font-size: 0.6875rem;
    color: var(--swal-text-secondary, #64748b);
  }

  .item-actions { display: flex; flex-direction: column; gap: 0.25rem; flex-shrink: 0; }

  @media (max-width: 640px) {
    .item { flex-direction: column; }
    .item-actions { flex-direction: row; }
  }
</style>