// tableQr.ts — carga SSR del pedido por QR (testeable, sin Astro).
import type { StorageAdapter, DomainRecord } from './domain';

type Rec = Record<string, unknown>;

export interface TableOrderPayload {
  table: { id: string; number: number | string; capacity: number | string };
  restaurant: { id: string; name: string } | null;
  menuItems: Array<{ id: string; name: string; price: number; categoryId: string; description?: string }>;
}

function alive(r: DomainRecord): boolean {
  return !(r as unknown as Rec).deleted_at;
}

export async function loadTableOrder(
  adapter: StorageAdapter,
  instanceId: string,
  code: string,
): Promise<TableOrderPayload | null> {
  const tables = ((await adapter.list('table', instanceId)) as DomainRecord[]).filter(alive);
  const table = tables.find((t) => String((t as unknown as Rec).qrCode) === code) as Rec | undefined;
  if (!table) return null;

  let restaurant: TableOrderPayload['restaurant'] = null;
  if (table.restaurantId) {
    const rest = (await adapter.get('restaurant', String(table.restaurantId), instanceId)) as Rec | null;
    if (rest && !rest.deleted_at) {
      restaurant = { id: String(rest.id), name: String(rest.name ?? '') };
    }
  }

  const menuItems = ((await adapter.list('menuItem', instanceId)) as DomainRecord[])
    .filter(alive)
    .map((m) => {
      const v = m as unknown as Rec;
      return {
        id: m.id,
        name: String(v.name ?? ''),
        price: Number(v.price ?? 0),
        categoryId: String(v.categoryId ?? ''),
        description: (v.description as string | undefined) ?? undefined,
      };
    });

  return {
    table: { id: String(table.id), number: table.number as number | string, capacity: table.capacity as number | string },
    restaurant,
    menuItems,
  };
}
