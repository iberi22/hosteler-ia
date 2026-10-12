import { describe, it, expect } from 'vitest';
import {
  calculateSalesSummary,
  calculateTopItems,
  calculateLowStock,
} from './analytics';
import type { StoreOrder, StoreMenuItem, StoreInventoryItem } from './storeSync';

describe('calculateSalesSummary', () => {
  it('calculates revenue and order status breakdown correctly with cents rounding', () => {
    const orders: StoreOrder[] = [
      {
        id: 'ord-1',
        tableId: 't1',
        status: 'completed',
        totalPrice: 24.25,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: [
          { menuItemId: 'm1', name: 'Burger', quantity: 2, unitPrice: 10.50 },
          { menuItemId: 'm2', name: 'Soda', quantity: 1, unitPrice: 3.25 },
        ],
      },
      {
        id: 'ord-2',
        tableId: 't2',
        status: 'pending',
        totalPrice: 15.00,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: [
          { menuItemId: 'm1', name: 'Burger', quantity: 1, unitPrice: 10.50 },
          { menuItemId: 'm3', name: 'Fries', quantity: 1, unitPrice: 4.50 },
        ],
      },
      {
        id: 'ord-3',
        tableId: null,
        status: 'completed',
        totalPrice: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: [],
      },
    ];

    const result = calculateSalesSummary(orders);

    expect(result.totalOrders).toBe(3);
    // (2 * 10.50 + 1 * 3.25) + (1 * 10.50 + 1 * 4.50) + 0 = 24.25 + 15.00 = 39.25
    expect(result.totalRevenue).toBe(39.25);
    expect(result.statusCounts).toEqual({
      completed: 2,
      pending: 1,
    });
  });

  it('handles empty orders without crashing', () => {
    const result = calculateSalesSummary([]);
    expect(result.totalOrders).toBe(0);
    expect(result.totalRevenue).toBe(0);
    expect(result.statusCounts).toEqual({});
  });
});

describe('calculateTopItems', () => {
  it('orders items by quantity sold descending and resolves names from menu items', () => {
    const menuItems: StoreMenuItem[] = [
      { id: 'm1', sku: 'M1', name: 'Classic Burger', price: 10.5, categoryId: 'c1', isAvailable: true, tags: [] },
      { id: 'm2', sku: 'M2', name: 'Super Soda', price: 3.25, categoryId: 'c2', isAvailable: true, tags: [] },
      { id: 'm3', sku: 'M3', name: 'Crispy Fries', price: 4.5, categoryId: 'c2', isAvailable: true, tags: [] },
    ];

    const orders: StoreOrder[] = [
      {
        id: 'o1',
        tableId: 't1',
        status: 'completed',
        totalPrice: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: [
          { menuItemId: 'm2', name: 'Soda', quantity: 5, unitPrice: 3.25 },
          { menuItemId: 'm1', name: 'Burger', quantity: 2, unitPrice: 10.50 },
        ],
      },
      {
        id: 'o2',
        tableId: 't2',
        status: 'completed',
        totalPrice: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: [
          { menuItemId: 'm3', name: 'Fries', quantity: 10, unitPrice: 4.50 },
          { menuItemId: 'm1', name: 'Burger', quantity: 4, unitPrice: 10.50 },
        ],
      },
    ];

    const top = calculateTopItems(orders, menuItems, 2);

    expect(top).toHaveLength(2);
    expect(top[0]).toEqual({
      menuItemId: 'm3',
      name: 'Crispy Fries',
      qty: 10,
      revenue: 45.0,
    });
    expect(top[1]).toEqual({
      menuItemId: 'm1',
      name: 'Classic Burger',
      qty: 6,
      revenue: 63.0,
    });
  });

  it('falls back to order item name or id if menu item is missing', () => {
    const orders: StoreOrder[] = [
      {
        id: 'o1',
        tableId: null,
        status: 'completed',
        totalPrice: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: [{ menuItemId: 'm-unknown', name: 'Special Pizza', quantity: 3, unitPrice: 12.0 }],
      },
    ];

    const top = calculateTopItems(orders, [], 5);
    expect(top[0].name).toBe('Special Pizza');
    expect(top[0].qty).toBe(3);
    expect(top[0].revenue).toBe(36.0);
  });
});

describe('calculateLowStock', () => {
  it('filters items with stock below minStock or default threshold', () => {
    const inventory: StoreInventoryItem[] = [
      { id: 'i1', sku: 'I1', name: 'Beef Patties', unit: 'kg', stock: 2, minStock: 10, costPerUnit: 5 },
      { id: 'i2', sku: 'I2', name: 'Buns', unit: 'pcs', stock: 50, minStock: 20, costPerUnit: 0.5 },
      { id: 'i3', sku: 'I3', name: 'Cheese', unit: 'kg', stock: 3, minStock: 0, costPerUnit: 4 }, // falls back to threshold 5
    ];

    const low = calculateLowStock(inventory, 5);

    expect(low).toHaveLength(2);
    expect(low[0].name).toBe('Beef Patties');
    expect(low[0].stock).toBe(2);
    expect(low[0].minStock).toBe(10);

    expect(low[1].name).toBe('Cheese');
    expect(low[1].stock).toBe(3);
    expect(low[1].minStock).toBe(5);
  });
});
