export const domainConfig = {
  appId: 'hosteler-ia',
  appName: "Fi'ze Hosteler-IA",
  // Instancia de datos de ESTE despliegue. `default` = fize.swal.network (demo). Un restaurante con despliegue
  // propio se compila con PUBLIC_FIZE_INSTANCE_ID=<slug> (script deploy-tenant.sh del repo privado de infraestructura): sus usuarios, sesiones
  // y datos quedan en otra instancia y no se cruzan con el demo.
  instanceId: ((import.meta.env ? import.meta.env.PUBLIC_FIZE_INSTANCE_ID : undefined) as string | undefined) || 'default',
  entities: [
    { name: 'restaurant', label: 'Restaurante', fields: ['name','slug','address'], xavierKind: 'restaurant' },
    { name: 'table', label: 'Mesa', fields: ['number','capacity','qrCode'], xavierKind: 'table' },
    { name: 'menuItem', label: 'Plato', fields: ['name','price','categoryId'], xavierKind: 'menu' },
    { name: 'category', label: 'Categoría', fields: ['name','description'], xavierKind: 'menu' },
    { name: 'order', label: 'Pedido', fields: ['tableId','status','items'], xavierKind: 'order' },
    { name: 'payment', label: 'Pago', fields: ['orderId','amount','method','source'], xavierKind: 'payment' },
    { name: 'inventoryItem', label: 'Inventario', fields: ['name','stock','unit','gosIngredientId','gramsPerUnit'], xavierKind: 'inventory' },
    { name: 'inventoryTx', label: 'Movimiento', fields: ['inventoryId','kind','qty'], xavierKind: 'inventory' },
    { name: 'user', label: 'Usuario', fields: ['email','name','role'], xavierKind: 'auth' },
    { name: 'session', label: 'Sesión', fields: ['userId','expiresAt'], xavierKind: 'auth' },
    // Capa de gestion que pidio el cliente: insumos, compras, recetas.
    { name: 'supplier', label: 'Proveedor', fields: ['name','taxId','creditDays'], xavierKind: 'supplier' },
    { name: 'purchase', label: 'Compra', fields: ['supplierId','invoiceNumber','lines','total'], xavierKind: 'purchase' },
    { name: 'recipe', label: 'Receta', fields: ['menuItemId','lines','prepTimeMin','cookTimeMin','cookTempC','visibility'], xavierKind: 'recipe' },
    // Avisos del panel. `notification` es una entidad que el cliente pidio desde
    // el portal de administracion: es el equivalente del read/unread que hereda
    // de Supabase, portado al StorageAdapter propio. Se filtra por instance_id
    // como todas las demas; `userId` es opcional (un aviso puede ser para todo
    // el restaurante, no para una persona en concreto).
    { name: 'notification', label: 'Aviso', fields: ['title','message','type','priority','userId','isRead','readAt'], xavierKind: 'notification' },
  ],
  aui: {
    enabled: true,
    allowAgentTheme: true,
  },
  billing: {
    tier: 'socio' as const,
    mode: 'swal-managed' as const,
  },
} as const;
export type DomainConfig = typeof domainConfig;
