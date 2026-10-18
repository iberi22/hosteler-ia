import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filterRows, isLowStock, ageInDays } from './bodegaView';

describe('bodegaView helpers', () => {
  const mockItems = [
    { id: '1', name: 'Manzana', sku: 'FR-01', quantity: 10, minStock: 5, cost: 0, price: 0, customFields: {} },
    { id: '2', name: 'Banana', sku: 'FR-02', quantity: 3, minStock: 5, cost: 0, price: 0, customFields: {} },
    { id: '3', name: 'Pera', sku: null, quantity: 5, minStock: 5, cost: 0, price: 0, customFields: {} },
  ];

  describe('filterRows', () => {
    it('returns all items when query is empty', () => {
      expect(filterRows(mockItems, '')).toHaveLength(3);
      expect(filterRows(mockItems, '   ')).toHaveLength(3);
    });

    it('filters by name (case-insensitive)', () => {
      const result = filterRows(mockItems, 'MAnz');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('filters by sku (case-insensitive)', () => {
      const result = filterRows(mockItems, 'fr-02');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('returns empty array when no matches', () => {
      const result = filterRows(mockItems, 'naranja');
      expect(result).toHaveLength(0);
    });
  });

  describe('isLowStock', () => {
    it('returns true when quantity is below minStock', () => {
      expect(isLowStock(mockItems[1])).toBe(true);
    });

    it('returns true when quantity equals minStock', () => {
      expect(isLowStock(mockItems[2])).toBe(true);
    });

    it('returns false when quantity is above minStock', () => {
      expect(isLowStock(mockItems[0])).toBe(false);
    });
  });

  describe('ageInDays', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Set fixed current time to 2026-10-16T12:00:00.000Z
      vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calculates 0 days for today', () => {
      expect(ageInDays('2026-10-16T08:00:00.000Z')).toBe(0);
    });

    it('calculates > 0 days for past dates', () => {
      expect(ageInDays('2026-10-14T12:00:00.000Z')).toBe(2);
    });

    it('handles negative diffs as 0', () => {
      expect(ageInDays('2026-10-17T12:00:00.000Z')).toBe(0);
    });
  });
});
