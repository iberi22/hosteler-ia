/**
 * Analytics pure aggregations.
 * Aggregates live domain records fetched from api/orders, api/menu-items, and api/inventory.
 */
import type { StoreOrder, StoreMenuItem, StoreInventoryItem } from './storeSync';

export interface SalesSummary {
  totalRevenue: number;
  totalOrders: number;
  statusCounts: Record<string, number>;
}

export interface TopItemSummary {
  menuItemId: string;
  name: string;
  qty: number;
  revenue: number;
}

export interface LowStockSummary {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
}

/**
 * Calculates revenue and status counts for orders.
 * Rounds total revenue to 2 decimal places to avoid JS floating-point issues.
 */
export function calculateSalesSummary(orders: StoreOrder[]): SalesSummary {
  let rawRevenue = 0;
  const statusCounts: Record<string, number> = {};

  for (const order of orders) {
    statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;
    if (order.items && Array.isArray(order.items)) {
      for (const item of order.items) {
        rawRevenue += Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0);
      }
    } else {
      rawRevenue += Number(order.totalPrice ?? 0);
    }
  }

  return {
    totalRevenue: Math.round(rawRevenue * 100) / 100,
    totalOrders: orders.length,
    statusCounts,
  };
}

/**
 * Calculates top selling items by quantity sold.
 * Resolves item names using menuItems map, falling back to name in order or menuItemId.
 */
export function calculateTopItems(
  orders: StoreOrder[],
  menuItems: StoreMenuItem[] = [],
  topN = 5,
): TopItemSummary[] {
  const menuMap = new Map<string, StoreMenuItem>();
  for (const m of menuItems) {
    menuMap.set(m.id, m);
  }

  const salesMap = new Map<string, { name: string; qty: number; revenue: number }>();

  for (const order of orders) {
    if (!order.items) continue;
    for (const item of order.items) {
      const id = item.menuItemId || 'unknown';
      const menuItem = menuMap.get(id);
      const name = menuItem?.name || item.name || id;
      const qty = Number(item.quantity ?? 0);
      const price = Number(item.unitPrice ?? menuItem?.price ?? 0);

      const current = salesMap.get(id) ?? { name, qty: 0, revenue: 0 };
      salesMap.set(id, {
        name: current.name || name,
        qty: current.qty + qty,
        revenue: Math.round((current.revenue + qty * price) * 100) / 100,
      });
    }
  }

  return [...salesMap.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, topN)
    .map(([menuItemId, data]) => ({
      menuItemId,
      name: data.name,
      qty: data.qty,
      revenue: data.revenue,
    }));
}

/**
 * Filters inventory items that are low in stock (stock < minStock, or stock < defaultThreshold if minStock is 0).
 */
export function calculateLowStock(
  inventory: StoreInventoryItem[],
  defaultThreshold = 5,
): LowStockSummary[] {
  return inventory
    .filter((item) => {
      const threshold = item.minStock > 0 ? item.minStock : defaultThreshold;
      return item.stock < threshold;
    })
    .map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      stock: item.stock,
      minStock: item.minStock > 0 ? item.minStock : defaultThreshold,
      unit: item.unit,
    }));
}
