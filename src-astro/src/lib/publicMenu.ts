// publicMenu.ts — carga SSR del menú público (testeable, sin Astro).
import type { DomainRecord, StorageAdapter } from "./domain";
import { sanitizePublicDescription } from "./publicMenuBySlug";

export interface PublicCategory {
	id: string;
	name: string;
}

export interface PublicMenuItem {
	id: string;
	name: string;
	price: number;
	categoryId: string;
	description?: string;
}

export interface PublicMenu {
	restaurant: { id: string; name: string } | null;
	categories: PublicCategory[];
	items: PublicMenuItem[];
}

type Rec = Record<string, unknown>;

function alive(r: DomainRecord): boolean {
	return !(r as unknown as Rec).deleted_at;
}

export async function loadPublicMenu(
	adapter: StorageAdapter,
	instanceId: string,
	restaurantId: string,
): Promise<PublicMenu> {
	const restaurant = (await adapter.get(
		"restaurant",
		restaurantId,
		instanceId,
	)) as Rec | null;
	const categories = (
		(await adapter.list("category", instanceId)) as DomainRecord[]
	)
		.filter(alive)
		.map((c) => ({ id: c.id, name: String((c as unknown as Rec).name ?? "") }));
	const items = ((await adapter.list("menuItem", instanceId)) as DomainRecord[])
		.filter(alive)
		.filter(m => m.isPublic !== false && m.isAvailable !== false && String(m.restaurantId ?? restaurantId) === restaurantId)
		.map((m) => {
			const v = m as unknown as Rec;
			const description = sanitizePublicDescription(v.description);
			return {
				id: m.id,
				name: String(v.name ?? ""),
				price: Number(v.price ?? 0),
				categoryId: String(v.categoryId ?? ""),
				...(description ? { description } : {}),
			};
		});

	return {
		restaurant:
			restaurant && alive(restaurant as unknown as DomainRecord)
				? { id: String(restaurant.id), name: String(restaurant.name ?? "") }
				: null,
		categories,
		items,
	};
}
