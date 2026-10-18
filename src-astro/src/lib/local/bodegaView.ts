import type { PlainInventorySnapshot } from '../inventoryExport';

export function filterRows(items: PlainInventorySnapshot['items'], query: string) {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return items;
  return items.filter(item =>
    item.name.toLowerCase().includes(normalizedQuery) ||
    (item.sku && item.sku.toLowerCase().includes(normalizedQuery))
  );
}

export function isLowStock(item: PlainInventorySnapshot['items'][number]) {
  return item.quantity <= item.minStock;
}

export function ageInDays(exportedAt: string) {
  const exported = new Date(exportedAt).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - exported);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
