// menu.svelte.ts — H1.05 — Menu + Category management store
export type MenuCategory = {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuItem = {
  id: string;
  sku: string;
  name: string;
  description?: string;
  price: number; // COP (pesos colombianos)
  categoryId: string;
  isAvailable: boolean;
  tags: string[]; // e.g. ["vegetariano", "picante"]
  imageUrl?: string;
};

export const CATEGORIES_ENDPOINT = '/api/categories';
export const MENU_ITEMS_ENDPOINT = '/api/menu-items';

export const categories = $state<MenuCategory[]>([
  { id: 'cat-entrantes', name: 'Entrantes', sortOrder: 1, isActive: true },
  { id: 'cat-principales', name: 'Principales', sortOrder: 2, isActive: true },
  { id: 'cat-postres', name: 'Postres', sortOrder: 3, isActive: true },
  { id: 'cat-bebidas', name: 'Bebidas', sortOrder: 4, isActive: true },
]);

export const menuItems = $state<MenuItem[]>([
  { id: 'm1', sku: 'ENT-001', name: 'Jamón ibérico', description: 'Con picos y pan artesanal', price: 14.90, categoryId: 'cat-entrantes', isAvailable: true, tags: [] },
  { id: 'm2', sku: 'ENT-002', name: 'Ensalada del hogar', description: 'Lechuga, tomate, queso de cabra', price: 8.50, categoryId: 'cat-entrantes', isAvailable: true, tags: ['vegetariano'] },
  { id: 'm3', sku: 'PRI-001', name: 'Solomillo al whisky', description: '300g con guarnición', price: 22.90, categoryId: 'cat-principales', isAvailable: true, tags: [] },
  { id: 'm4', sku: 'PRI-002', name: 'Paella Valenciana', description: 'Para 2 personas mínimo', price: 18.50, categoryId: 'cat-principales', isAvailable: true, tags: [] },
  { id: 'm5', sku: 'POS-001', name: 'Tarta de queso', description: 'Horneada, mermelada de frutos rojos', price: 6.90, categoryId: 'cat-postres', isAvailable: false, tags: ['vegetariano'] },
  { id: 'm6', sku: 'BEB-001', name: 'Vino de la casa (1/2l)', description: 'Tinto joven DO Valencia', price: 5.90, categoryId: 'cat-bebidas', isAvailable: true, tags: [] },
]);

export function getItemsByCategory(catId: string): MenuItem[] {
  return menuItems.filter(m => m.categoryId === catId && m.isAvailable);
}

export function setCategories(newCats: MenuCategory[]) {
  categories.length = 0;
  categories.push(...newCats);
}

export function setMenuItems(newItems: MenuItem[]) {
  menuItems.length = 0;
  menuItems.push(...newItems);
}

export function upsertCategory(cat: MenuCategory) {
  const idx = categories.findIndex(c => c.id === cat.id);
  if (idx !== -1) {
    categories[idx] = cat;
  } else {
    categories.push(cat);
  }
}

export function upsertMenuItem(item: MenuItem) {
  const idx = menuItems.findIndex(m => m.id === item.id);
  if (idx !== -1) {
    menuItems[idx] = item;
  } else {
    menuItems.push(item);
  }
}

export function addCategory(cat: MenuCategory) {
  categories.push(cat);
}

export function updateCategory(id: string, patch: Partial<MenuCategory>) {
  const c = categories.find(c => c.id === id);
  if (c) Object.assign(c, patch);
}

export function deleteCategory(id: string) {
  const idx = categories.findIndex(c => c.id === id);
  if (idx !== -1) categories.splice(idx, 1);
}

export function addMenuItem(item: MenuItem) {
  menuItems.push(item);
}

export function updateMenuItem(id: string, patch: Partial<MenuItem>) {
  const m = menuItems.find(m => m.id === id);
  if (m) Object.assign(m, patch);
}

export function deleteMenuItem(id: string) {
  const idx = menuItems.findIndex(m => m.id === id);
  if (idx !== -1) menuItems.splice(idx, 1);
}

export function toggleAvailability(id: string) {
  const m = menuItems.find(m => m.id === id);
  if (m) m.isAvailable = !m.isAvailable;
}

// --- Wave-H2.10: wire a StorageAdapter/API ---
import type { DomainRecord } from '../lib/domain';
import { mapCategory, mapMenuItem, fetchCollection } from '../lib/storeSync';
import { domainConfig } from '../lib/domain.config';

export function applyMenuRecords(categoryRecords: DomainRecord[], itemRecords: DomainRecord[]) {
  categories.length = 0;
  categories.push(...categoryRecords.map((r, i) => mapCategory(r, i)));
  menuItems.length = 0;
  menuItems.push(...itemRecords.map(mapMenuItem));
}

export async function refreshMenuFromApi(fetchFn: typeof fetch = fetch, instanceId = domainConfig.instanceId) {
  const [cats, items] = await Promise.all([
    fetchCollection(fetchFn, 'categories', instanceId),
    fetchCollection(fetchFn, 'menu-items', instanceId),
  ]);
  applyMenuRecords(cats, items);
}
