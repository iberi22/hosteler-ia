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
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Tope de tamaño para el archivo de inventario importado (5 MB). Se comprueba
// antes de leer el archivo a memoria, para no cargar un archivo enorme por error.
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function isImportTooBig(sizeBytes: number): boolean {
  return sizeBytes > MAX_IMPORT_BYTES;
}
