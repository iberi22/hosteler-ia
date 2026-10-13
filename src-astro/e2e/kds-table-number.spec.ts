import { expect, type Page, test } from "@playwright/test";

test("onboards local, creates table 1, adds order and KDS shows Mesa 1", async ({
	page,
}) => {
	// Onboard
	await page.goto("/local/");
	await page.getByRole("button", { name: "Empezar" }).click();
	await page.getByRole("button", { name: "Siguiente" }).click();
	await page.getByLabel("Nombre del negocio").fill("Fonda");
	await page.getByLabel("WhatsApp para pedidos").fill("300 123 4567");
	await page.getByLabel("Dirección").fill("Cra 1");
	await page.getByRole("button", { name: "Siguiente" }).click();
	await page.getByLabel("Ya lo anoté en un lugar seguro").check();
	await page.getByRole("button", { name: "Siguiente" }).click();
	await page.getByLabel("Nueva categoría").fill("Carta");
	await page.getByRole("button", { name: "Agregar categoría" }).click();
	await page.getByLabel("Plato").fill("Tinto");
	await page.getByLabel("Precio (COP)").fill("1000");
	await page.getByRole("button", { name: "Agregar plato" }).click();

	// Create Table 1
	await page.goto("/local/mesas/");
	await page.getByPlaceholder("Nº de Mesa").fill("1");
	await page.getByPlaceholder("Capacidad (pax)").fill("4");
	await page.getByRole("button", { name: "Añadir Mesa" }).click();
	await expect(page.getByText('Mesa 1')).toBeVisible();

	// Create Order
	await page.goto("/local/nuevo-pedido/");
	await page
		.locator("select#take-order-table")
		.selectOption({ label: "Mesa 1 (4 pax)" });
	await page.getByRole("button", { name: "Añadir Tinto" }).click();
	await page.getByRole("button", { name: "Crear pedido" }).click();
    await expect(page.getByText('Pedido creado')).toBeVisible();

	// Check KDS
	await page.goto("/local/cocina/");
	await expect(page.locator(".kds-card").first()).toBeVisible({ timeout: 15_000 });
	await expect(page.locator(".kds-card").first()).toContainText("Mesa 1");
});
