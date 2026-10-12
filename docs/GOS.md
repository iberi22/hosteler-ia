# Fize consume GOS v1

El contrato del ecosistema reside en `docs/ecosistema-salud/CONTRATO-DATOS.md`
del workspace SWAL; el contrato del cliente en GOS `docs/CONSUMERS.md`.
El snapshot vendorizado identifica `gastronomic-open-standard-GOS salud/g2 b8d50775`.
Solo se adapta package.json para resolver los exports TypeScript desde Astro/Vite.

## Inventario y recetas

Los nombres, cantidades, unidades y costos del inventario son datos operativos del
restaurante. No se crea una tabla alimentaria propia ni se copian nutrientes a los
registros. El formulario de inventario y el editor de recetas permiten guardar
`gosIngredientId` y `gramsPerUnit` opcionales (null permite desvincular).
Las unidades volumétricas y piezas requieren peso explícito; no se supone densidad.
Los registros anteriores sin vínculo funcionan sin migración destructiva.

Se multiplica `qty × gramsPerUnit`. `menuItem.recipe` representa una porción;
las líneas de una entidad `recipe` se dividen por su `yield`. Si hay varias recetas
para un plato se utiliza la última actualizada. Los nutrientes se agregan mediante
`client.nutritionFor`; claves ausentes permanecen ausentes. La etiqueta parcial
incluye los vínculos resueltos sobre todas las líneas y también refleja nutrientes
incompletos. Las etiquetas positivas de alérgenos proceden del dataset GOS; jamás
se infieren por nombre. Una lista vacía no certifica ausencia de alérgenos.

## Caché, privacidad y disponibilidad

`PUBLIC_GOS_API` se establece al construir (default https://gos.swal.network/api/v1).
En navegador el singleton usa IndexedDB `fize-gos-v1`; SSR usa memoria.
Una restricción de IndexedDB cae a memoria de sesión. Las peticiones GOS tienen
un límite de 2,5 segundos. La primera carga sin red devuelve resultados vacíos;
una copia previa continúa disponible y se actualiza en segundo plano.
Cada cálculo fija una colección y su versión/hash para no mezclar actualizaciones.

La carta renderiza y permite pedidos antes de solicitar `/api/menu-nutrition`.
El servidor lee recetas privadas dentro del adaptador, pero solo proyecta totales,
alérgenos, parcialidad e identidad del dataset de los platos públicos de esa carta.
Ni las líneas, ni los costos, ni las notas cruzan la frontera pública.
La proyección pública se conserva en IndexedDB `fize-public-nutrition-v1` para
reutilizarla sin conexión; puede corresponder a la última consulta exitosa.
Un 503 conserva esa copia; un 200 vacío elimina los totales ya desvinculados.
La atribución incluye `version+sha256:contentHash` de la colección utilizada.
Los fixtures son un subconjunto del export real de GOS, exclusivos de tests.
