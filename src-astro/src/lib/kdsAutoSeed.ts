// kdsAutoSeed.ts — unica puerta de la demo del KDS (KitchenQueue).
//
// Politica: en modo local (/local/*) NUNCA se escribe nada implicito — ni
// fantasmas en memoria (404 al pulsar) ni pedidos y mesas REALES en la
// IndexedDB del restaurante, que una vez cobrados contaminarian
// ventas/historial. Cada vez que la cola se vacia (inicio del dia, tras cobrar
// todo) el KDS local muestra estado vacio, no resiembra.
//
// La unica excepcion local es la intencion demo EXPLICITA (`?demo=1` en la
// URL, que usa el E2E offline-local-first): entonces se siembra por la API
// local (pedidos reales en IndexedDB, los mismos que leen las transiciones y
// el cobro). Un restaurante real jamas navega con esa bandera, asi que su base
// nunca recibe demo implicita. En el dashboard servido (/dashboard/kitchen) se
// conserva la demo en memoria de siempre.
export function isDemoFlaggedUrl(search?: string): boolean {
  try {
    const qs =
      typeof search === 'string'
        ? search
        : typeof window !== 'undefined'
          ? window.location.search
          : '';
    return new URLSearchParams(qs).get('demo') === '1';
  } catch {
    return false;
  }
}

export function shouldSeedKdsDemo(opts: {
  autoPublish: boolean;
  orderCount: number;
  localMode: boolean;
  /** Solo relevante en modo local: `?demo=1` explicito. */
  demoFlag?: boolean;
}): boolean {
  if (!opts.autoPublish || opts.orderCount !== 0) return false;
  // Servidor: demo en memoria de siempre. Local: solo con bandera explicita.
  return opts.localMode ? opts.demoFlag === true : true;
}
