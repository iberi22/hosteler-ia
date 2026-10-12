<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Badge, Button } from '@swal/ui';
  import { cloudClient } from '../../cloud/client';
  import { suggestSlug, validateSlug, validateWhatsapp } from '../../lib/restaurantRules';
  import { apiFetch } from '../../lib/api-client';
  import { isLocalMode } from '../../lib/local/localMode';

  interface Restaurant {
    id: string;
    name: string;
    slug: string;
    address: string;
    phone?: string;
    instance_id?: string;
    created_at?: string;
    updated_at?: string;
  }

  // En modo local (/local/ajustes/) no hay plan ni consumo de IA: solo el perfil, guardado en este equipo.
  const local = isLocalMode();

  let loading = $state(true);
  let userEmail = $state<string>('');
  let restaurant = $state<Restaurant | null>(null);
  let originalRestaurant = $state<Restaurant | null>(null);

  // Form fields
  let name = $state('');
  let slug = $state('');
  let address = $state('');
  let phone = $state('');
  // Mientras el usuario no edite el slug a mano, se sugiere desde el nombre.
  let slugTouched = $state(false);

  // Status & error state
  let serverError = $state<string | null>(null);
  let successMessage = $state<string | null>(null);
  let isSubmitting = $state(false);

  // Plan, creditos y consumo son del modulo cloud: sin el (o en modo local) no se muestran.
  const PlanPanel = local ? null : (cloudClient.plan?.Panel ?? null);
  const UsagePanel = local ? null : (cloudClient.usage?.Panel ?? null);

  async function loadData() {
    loading = true;
    serverError = null;
    try {
      const mePromise = apiFetch('/api/auth/me').then(async (r) => (r.ok ? r.json() : null)).catch(() => null);
      const restPromise = apiFetch('/api/restaurants').then(async (r) => (r.ok ? r.json() : null)).catch(() => null);

      const [meData, restData] = await Promise.all([mePromise, restPromise]);

      if (meData?.user?.email) {
        userEmail = meData.user.email;
      }

      if (Array.isArray(restData)) {
        const active = restData.filter((r: Record<string, unknown>) => !r.deleted_at);
        if (active.length > 0) {
          const first = active[0] as Restaurant;
          restaurant = first;
          originalRestaurant = { ...first };
          name = first.name ?? '';
          slug = first.slug ?? '';
          address = first.address ?? '';
          phone = first.phone ?? '';
        }
      }
    } catch (e: unknown) {
      const err = e as Error;
      serverError = err.message || 'Error al cargar los datos';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadData();
  });

  async function handleSave(e: Event) {
    e.preventDefault();
    serverError = null;
    successMessage = null;

    if (!restaurant) return;

    if (slug !== originalRestaurant?.slug) {
      const slugError = validateSlug(slug);
      if (slugError) {
        serverError = slugError;
        return;
      }
    }

    const whatsapp = validateWhatsapp(phone);
    if (!whatsapp.ok) {
      serverError = whatsapp.error;
      return;
    }

    // Send ONLY edited fields
    const patchData: Record<string, string> = {};
    if (name !== originalRestaurant?.name) patchData.name = name;
    if (slug !== originalRestaurant?.slug) patchData.slug = slug;
    if (address !== originalRestaurant?.address) patchData.address = address;
    if (whatsapp.phone !== (originalRestaurant?.phone ?? '')) patchData.phone = whatsapp.phone;

    if (Object.keys(patchData).length === 0) {
      successMessage = 'No hay cambios para guardar.';
      return;
    }

    isSubmitting = true;
    try {
      const res = await apiFetch(`/api/restaurants/${restaurant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchData)
      });

      const data = await res.json();
      if (!res.ok) {
        serverError = data.error || 'Error al actualizar el restaurante';
        return;
      }

      restaurant = data;
      originalRestaurant = { ...data };
      name = data.name ?? name;
      slug = data.slug ?? slug;
      address = data.address ?? address;
      phone = data.phone ?? '';
      successMessage = 'Perfil de restaurante actualizado correctamente.';
    } catch (e: unknown) {
      const err = e as Error;
      serverError = err.message || 'Error de conexión';
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    serverError = null;
    successMessage = null;

    if (!name.trim() || !slug.trim() || !address.trim()) {
      serverError = 'Todos los campos son requeridos (nombre, slug y dirección).';
      return;
    }

    const slugError = validateSlug(slug);
    if (slugError) {
      serverError = slugError;
      return;
    }

    const whatsapp = validateWhatsapp(phone);
    if (!whatsapp.ok) {
      serverError = whatsapp.error;
      return;
    }

    isSubmitting = true;
    try {
      const res = await apiFetch('/api/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          address: address.trim(),
          ...(whatsapp.phone ? { phone: whatsapp.phone } : {})
        })
      });

      const data = await res.json();
      if (!res.ok) {
        serverError = data.error || 'Error al crear el restaurante';
        return;
      }

      restaurant = data;
      originalRestaurant = { ...data };
      name = data.name ?? '';
      slug = data.slug ?? '';
      address = data.address ?? '';
      phone = data.phone ?? '';
      successMessage = 'Restaurante creado correctamente.';
    } catch (e: unknown) {
      const err = e as Error;
      serverError = err.message || 'Error de conexión';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="settings-container">
  {#if loading}
    <Card variant="surface" padding="md">
      <p class="loading-text">Cargando configuración...</p>
    </Card>
  {:else}
    <div class="panels-grid" class:single={!PlanPanel}>
      <!-- Profile Panel -->
      <section class="panel-section">
        <Card variant="surface" padding="md">
          <div class="card-header">
            <div>
              <h2>Perfil del Restaurante</h2>
              <p class="sub-text">Gestiona la información principal de tu establecimiento.</p>
            </div>
            {#if restaurant}
              <Badge variant="info">ID: {restaurant.id.slice(0, 8)}...</Badge>
            {/if}
          </div>

          {#if serverError}
            <div class="alert alert-error" role="alert">
              <strong>Error:</strong> {serverError}
            </div>
          {/if}

          {#if successMessage}
            <div class="alert alert-success" role="status">
              {successMessage}
            </div>
          {/if}

          {#if restaurant}
            <form onsubmit={handleSave} class="form-grid">
              <div class="form-group">
                <label for="rest-name">Nombre del Restaurante</label>
                <input
                  id="rest-name"
                  type="text"
                  bind:value={name}
                  required
                  class="form-input"
                  placeholder="Ej: El Sazón de la Abuela"
                />
              </div>

              <div class="form-group">
                <label for="rest-slug">Slug (Identificador URL)</label>
                <input
                  id="rest-slug"
                  type="text"
                  bind:value={slug}
                  required
                  class="form-input"
                  placeholder="ej-sazon-abuela"
                  aria-describedby="rest-slug-help"
                />
                <p id="rest-slug-help" class="field-help">
                  Es la dirección de tu carta: /{slug || 'tu-restaurante'}/menu. Solo minúsculas sin tildes, números y guiones (3 a 60 caracteres). Si lo cambias, los QR de la carta impresos con el slug anterior dejan de funcionar.
                </p>
              </div>

              <div class="form-group">
                <label for="rest-address">Dirección</label>
                <input
                  id="rest-address"
                  type="text"
                  bind:value={address}
                  required
                  class="form-input"
                  placeholder="Calle Principal #123, Ciudad"
                />
              </div>

              <div class="form-group">
                <label for="rest-phone">WhatsApp para pedidos</label>
                <input
                  id="rest-phone"
                  type="tel"
                  inputmode="tel"
                  autocomplete="tel"
                  bind:value={phone}
                  aria-describedby="rest-phone-help"
                  class="form-input"
                  placeholder="+57 300 123 4567"
                />
                <p id="rest-phone-help" class="field-help">
                  Los pedidos de tu carta llegan a este número. Sin él, el botón "Pedir por WhatsApp" no aparece.
                </p>
              </div>

              <div class="form-actions">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
                </Button>
              </div>
            </form>
          {:else}
            <div class="empty-state">
              <div class="empty-badge">
                <Badge variant="warning">No restaurant yet</Badge>
              </div>
              <p class="empty-desc">No hay ningún restaurante configurado para esta cuenta. Crea uno a continuación:</p>

              <form onsubmit={handleCreate} class="form-grid">
                <div class="form-group">
                  <label for="new-rest-name">Nombre del Restaurante</label>
                  <input
                    id="new-rest-name"
                    type="text"
                    bind:value={name}
                    oninput={() => {
                      if (!slugTouched) slug = suggestSlug(name);
                    }}
                    required
                    class="form-input"
                    placeholder="Ej: Mi Nuevo Restaurante"
                  />
                </div>

                <div class="form-group">
                  <label for="new-rest-slug">Slug (URL)</label>
                  <input
                    id="new-rest-slug"
                    type="text"
                    bind:value={slug}
                    oninput={() => (slugTouched = true)}
                    required
                    class="form-input"
                    placeholder="mi-nuevo-restaurante"
                    aria-describedby="new-rest-slug-help"
                  />
                  <p id="new-rest-slug-help" class="field-help">
                    Se sugiere desde el nombre. Será la dirección de tu carta: /{slug || 'tu-restaurante'}/menu. Solo minúsculas sin tildes, números y guiones (3 a 60 caracteres).
                  </p>
                </div>

                <div class="form-group">
                  <label for="new-rest-address">Dirección</label>
                  <input
                    id="new-rest-address"
                    type="text"
                    bind:value={address}
                    required
                    class="form-input"
                    placeholder="Av. Central 456"
                  />
                </div>

                <div class="form-group">
                  <label for="new-rest-phone">WhatsApp para pedidos</label>
                  <input
                    id="new-rest-phone"
                    type="tel"
                    inputmode="tel"
                    autocomplete="tel"
                    bind:value={phone}
                    aria-describedby="new-rest-phone-help"
                    class="form-input"
                    placeholder="+57 300 123 4567"
                  />
                  <p id="new-rest-phone-help" class="field-help">
                    Los pedidos de tu carta llegan a este número. Sin él, el botón "Pedir por WhatsApp" no aparece.
                  </p>
                </div>

                <div class="form-actions">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Creando...' : 'Crear Restaurante'}
                  </Button>
                </div>
              </form>
            </div>
          {/if}
        </Card>
      </section>

      <!-- Plan y suscripcion: solo con el modulo cloud (src/cloud) y fuera del modo local. -->
      {#if PlanPanel}
        <section class="panel-section">
          <PlanPanel {userEmail} />
        </section>
      {/if}
    </div>

    <!-- Consumo y facturas (SAAS-09): solo con el modulo cloud y fuera del modo local. -->
    {#if UsagePanel}
      <UsagePanel />
    {/if}
  {/if}
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .loading-text {
    color: var(--swal-text-secondary, #94a3b8);
    font-size: 0.95rem;
  }

  .panels-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  @media (max-width: 900px) {
    .panels-grid {
      grid-template-columns: 1fr;
    }
  }

  .panels-grid.single {
    grid-template-columns: 1fr;
  }

  .panel-section {
    display: flex;
    flex-direction: column;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.25rem;
  }

  .card-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--swal-text, #e2e8f0);
  }

  .sub-text {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: var(--swal-text-secondary, #94a3b8);
  }

  .alert {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .alert-error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
  }

  .alert-success {
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.4);
    color: #86efac;
  }

  .form-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-group label {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--swal-text-secondary, #cbd5e1);
  }

  .form-input {
    background: var(--swal-bg-elevated, #1e293b);
    border: 1px solid var(--swal-border, #334155);
    border-radius: 6px;
    padding: 0.625rem 0.75rem;
    color: var(--swal-text, #f8fafc);
    font-size: 0.9rem;
    outline: none;
    transition: border-color 150ms;
  }

  .field-help {
    margin: 0;
    font-size: 0.75rem;
    color: var(--swal-text-secondary, #94a3b8);
  }

  .form-input:focus {
    border-color: var(--swal-accent-cyan, #22d3ee);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .empty-badge {
    margin-bottom: 0.25rem;
  }

  .empty-desc {
    font-size: 0.9rem;
    color: var(--swal-text-secondary, #94a3b8);
    margin: 0;
  }
</style>
