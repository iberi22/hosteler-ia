import { expect, type Page, test } from "@playwright/test";

// QA pre-entrega 2026-10-13 #1 (CRITICO): parseFloat en 38.000 guardaba 38 en vez de 38000.
// Este test asegura que el parser de precios (parseCopPrice) funciona bien desde la UI (onboarding).

// Onboarding hasta el paso 4: deja creada la identidad del local en `fize-local`.
async function onboardLocal(page: Page) {
	await page.goto("/local/");
	await page.getByRole("button", { name: "Empezar" }).click();
	await page.getByRole("button", { name: "Siguiente" }).click();
	await page.getByLabel("Nombre del negocio").fill("Local Prueba");
	await page.getByLabel("WhatsApp para pedidos").fill("300 123 4567");
	await page.getByLabel("Dirección").fill("Calle Falsa 123");
	await page.getByRole("button", { name: "Siguiente" }).click();
	await expect(page.getByTestId("paso")).toHaveText("Paso 4 de 6");
}

// Siembra un registro en `fize-db` (un store por entidad).
async function seedLocal(
	page: Page,
	store: "category" | "menuItem" | "order",
	record: Record<string, unknown>,
) {
	await page.evaluate(
		async ({ store, record }) => {
			const openDb = (name: string) =>
				new Promise<IDBDatabase>((resolve, reject) => {
					const req = indexedDB.open(name);
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
			const kv = await openDb("fize-local");
			const identity = await new Promise<{ instanceId: string }>(
				(resolve, reject) => {
					const req = kv.transaction("kv").objectStore("kv").get("identity");
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				},
			);
			kv.close();
			const db = await openDb("fize-db");
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(store, "readwrite");
				tx.objectStore(store).put({
					...record,
					instance_id: identity.instanceId,
				});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
		},
		{ store, record },
	);
}

test("crear un plato con precio 38.000 se guarda y muestra como 38000, no 38", async ({
	page,
}) => {
	// 1. Onboarding inicial para tener identidad
	await onboardLocal(page);

	// 2. Crear una categoría en IndexedDB para no tener que crearla en la UI
	await seedLocal(page, "category", {
		id: "mock-cat",
		name: "Cat Inicial",
		description: "",
		created_at: new Date().toISOString(),
	});

	// 3. Navegar a la página de edición de la carta directamente
	await page.goto("/local/carta/");

	// 4. Crear el plato "Prueba" con precio 38.000 en /local/carta/
	// Le damos más tiempo para que renderice los componentes antes de interactuar con ellos
	await page.getByRole("button", { name: "+ Nuevo artículo" }).click();
	await page.getByLabel("SKU").fill("ENT-001");
	await page.getByLabel("Nombre *").fill("Prueba");
	await page.locator("#price").fill("38.000");
	await page.getByRole("button", { name: "Guardar" }).click();

	// Si hay error en el modal (ej. "Precio inválido"), no se cerrará. Nos aseguramos de que se cierra.
	await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

	// Recargar la página para asegurar que el dato está correctamente persistido
	await page.reload();

	// 5. Asegurarse de que el artículo aparezca en la lista (reusando exact text como sugerido)
	await expect(page.getByText("Prueba", { exact: true })).toBeVisible();

	// 6. Verificar que el precio almacenado y mostrado es 38.000 y no 38
	// Filtramos la tarjeta por el texto "Prueba" para buscar adentro
	const card = page
		.locator(".menu-card, article")
		.filter({ hasText: "Prueba" })
		.first();
	await expect(card).toContainText("38.000");

	// 7. Buscamos que explícitamente no se muestre como 38 (sin los miles)
	const allText = await card.textContent();
	expect(allText).not.toMatch(/\$ 38(?!(\.|\d))/);
});
