// cart.svelte.ts — Svelte 5 runes (zusta persist → $state + localStorage guard) H1.08
export type CartItem = { id: string; menuItemId: string; name: string; quantity: number; unitPrice: number; totalPrice: number; modifications?: string[] };

export const cart = $state<{ items: CartItem[]; tableId: string | null; isLoading: boolean }>({
  items: [],
  tableId: null,
  isLoading: false,
});

export function addItem(item: Omit<CartItem, 'id' | 'totalPrice'> & { id?: string }) {
  const id = item.id ?? `${item.menuItemId}-${Date.now()}`;
  const existing = cart.items.find((i) => i.menuItemId === item.menuItemId && JSON.stringify(i.modifications ?? []) === JSON.stringify(item.modifications ?? []));
  if (existing) {
    existing.quantity += item.quantity;
    existing.totalPrice = existing.unitPrice * existing.quantity;
  } else {
    cart.items.push({ ...item, id, totalPrice: item.unitPrice * item.quantity } as CartItem);
  }
  persist();
}
export function removeItem(id: string) { cart.items = cart.items.filter((i) => i.id !== id); persist(); }
export function updateQuantity(id: string, qty: number) {
  const it = cart.items.find((i) => i.id === id);
  if (it) { it.quantity = qty; it.totalPrice = it.unitPrice * qty; persist(); }
}
export function clearCart() { cart.items = []; persist(); }
export function setTableId(t: string | null) { cart.tableId = t; persist(); }
export function setLoading(v: boolean) { cart.isLoading = v; }
export function getItemCount() { return cart.items.reduce((a, b) => a + b.quantity, 0); }
export function getSubtotal() { return cart.items.reduce((a, b) => a + b.totalPrice, 0); }

function persist() {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('fize:cart', JSON.stringify(cart)); } catch {}
}
export function hydrate() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('fize:cart');
    if (raw) { const d = JSON.parse(raw); cart.items = d.items ?? []; cart.tableId = d.tableId ?? null; }
  } catch {}
}
