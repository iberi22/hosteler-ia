// connectivity.ts — helpers puros del banner offline (testeables).
export function queueMessage(pendingOrders: number, pendingMutations: number, online: boolean): string {
  const total = pendingOrders + pendingMutations;
  if (online && total === 0) return '';
  if (!online && total === 0) return 'Sin conexión — los cambios se guardarán localmente';
  if (!online) return `Sin conexión — ${total} pendiente(s) de envío`;
  return `Sincronizando ${total} pendiente(s)…`;
}

export function shouldShowBanner(pendingOrders: number, pendingMutations: number, online: boolean): boolean {
  return queueMessage(pendingOrders, pendingMutations, online) !== '';
}
