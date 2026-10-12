import { mapOrder, type StoreOrder } from './storeSync';
import type { DomainRecord } from './domain';

export function normalizeOrdersPayload(data: unknown): StoreOrder[] {
  let records: unknown[] = [];
  if (Array.isArray(data)) {
    records = data;
  } else if (
    data !== null &&
    typeof data === 'object' &&
    'list' in data &&
    Array.isArray((data as { list: unknown }).list)
  ) {
    records = (data as { list: unknown[] }).list;
  }
  return records.map((r) => mapOrder(r as DomainRecord));
}
