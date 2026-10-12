// menuSync.ts — pure async helpers for Menu & Category API CRUD persistence
import { apiFetch } from './api-client';
import type { DomainRecord } from './domain';
import {
  mapCategory,
  mapMenuItem,
  type StoreMenuCategory,
  type StoreMenuItem,
} from './storeSync';
import { domainConfig } from './domain.config';

export interface CreateCategoryPayload {
  name: string;
  description?: string;
  instance_id?: string;
}

export interface UpdateCategoryPayload {
  name?: string;
  description?: string;
  isActive?: boolean;
}

export interface CreateMenuItemPayload {
  name: string;
  price: number;
  categoryId: string;
  description?: string;
  recipe?: Array<{ inventoryId: string; qty: number }>;
  instance_id?: string;
}

export interface UpdateMenuItemPayload {
  name?: string;
  price?: number;
  categoryId?: string;
  description?: string;
  isAvailable?: boolean;
  recipe?: Array<{ inventoryId: string; qty: number }>;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data === 'object') {
        if (data.error) errMsg = data.error;
        if (data.details) errMsg += `: ${JSON.stringify(data.details)}`;
      }
    } catch {
      /* fallback to HTTP status */
    }
    throw new Error(errMsg);
  }
  return (await res.json()) as T;
}

export async function fetchCategoriesApi(instanceId = domainConfig.instanceId): Promise<StoreMenuCategory[]> {
  const res = await apiFetch(`/api/categories?instance_id=${encodeURIComponent(instanceId)}`);
  const records = await handleResponse<DomainRecord[]>(res);
  return records.map((r, i) => mapCategory(r, i));
}

export async function fetchMenuItemsApi(instanceId = domainConfig.instanceId): Promise<StoreMenuItem[]> {
  const res = await apiFetch(`/api/menu-items?instance_id=${encodeURIComponent(instanceId)}`);
  const records = await handleResponse<DomainRecord[]>(res);
  return records.map(mapMenuItem);
}

export async function createCategoryApi(
  payload: CreateCategoryPayload,
  instanceId = domainConfig.instanceId,
): Promise<StoreMenuCategory> {
  const res = await apiFetch(`/api/categories?instance_id=${encodeURIComponent(instanceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, instance_id: payload.instance_id ?? instanceId }),
  });
  const record = await handleResponse<DomainRecord>(res);
  return mapCategory(record);
}

export async function updateCategoryApi(
  id: string,
  payload: UpdateCategoryPayload,
  instanceId = domainConfig.instanceId,
): Promise<StoreMenuCategory> {
  const res = await apiFetch(`/api/categories/${encodeURIComponent(id)}?instance_id=${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const record = await handleResponse<DomainRecord>(res);
  return mapCategory(record);
}

export async function deleteCategoryApi(id: string, instanceId = domainConfig.instanceId): Promise<void> {
  const res = await apiFetch(`/api/categories/${encodeURIComponent(id)}?instance_id=${encodeURIComponent(instanceId)}`, {
    method: 'DELETE',
  });
  await handleResponse<{ message: string }>(res);
}

export async function createMenuItemApi(
  payload: CreateMenuItemPayload,
  instanceId = domainConfig.instanceId,
): Promise<StoreMenuItem> {
  const res = await apiFetch(`/api/menu-items?instance_id=${encodeURIComponent(instanceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, instance_id: payload.instance_id ?? instanceId }),
  });
  const record = await handleResponse<DomainRecord>(res);
  return mapMenuItem(record);
}

export async function updateMenuItemApi(
  id: string,
  payload: UpdateMenuItemPayload,
  instanceId = domainConfig.instanceId,
): Promise<StoreMenuItem> {
  const res = await apiFetch(`/api/menu-items/${encodeURIComponent(id)}?instance_id=${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const record = await handleResponse<DomainRecord>(res);
  return mapMenuItem(record);
}

export async function deleteMenuItemApi(id: string, instanceId = domainConfig.instanceId): Promise<void> {
  const res = await apiFetch(`/api/menu-items/${encodeURIComponent(id)}?instance_id=${encodeURIComponent(instanceId)}`, {
    method: 'DELETE',
  });
  await handleResponse<{ message: string }>(res);
}
