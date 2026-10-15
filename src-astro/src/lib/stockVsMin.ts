// stockVsMin.ts — hecho puro: cuanto stock hay frente al minimo configurado de cada insumo.
// No estima consumo ni dias restantes (no hay prediccion): solo compara dos numeros que el local ya cargo.

export type StockLevel = 'critical' | 'low' | 'ok';

export interface StockLike {
  id: string;
  name: string;
  sku?: string;
  unit?: string;
  stock: number;
  minStock: number;
}

export interface StockVsMinRow<T extends StockLike = StockLike> {
  item: T;
  /** stock / minStock (0 = agotado, 1 = justo en el minimo). */
  ratio: number;
  level: StockLevel;
}

/** Mismos umbrales que StockAlerts: agotado o <= 50% del minimo es critico, <= minimo es bajo. */
export function stockLevel(stock: number, minStock: number): StockLevel {
  if (stock <= 0 || stock <= minStock * 0.5) return 'critical';
  if (stock <= minStock) return 'low';
  return 'ok';
}

/** Los `limit` insumos con menos stock respecto a su minimo. Ignora los que no tienen minimo. */
export function stockVsMin<T extends StockLike>(items: T[], limit = 5): StockVsMinRow<T>[] {
  return items
    .filter((i) => i.minStock > 0)
    .map((item) => ({ item, ratio: Math.max(0, item.stock) / item.minStock, level: stockLevel(item.stock, item.minStock) }))
    .sort((a, b) => a.ratio - b.ratio || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}
