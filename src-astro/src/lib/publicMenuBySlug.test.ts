import { beforeEach, describe, expect, it } from "vitest";
import {
  POST as createRecipe,
  GET as getRecipes,
} from "../pages/api/recipes/index";
import { getMemoryAdapter } from "./domain";
import {
  dedupeMenuItems,
  findRestaurantBySlug,
  loadMenuBySlug,
  normalizeSlug,
  sanitizePublicDescription,
} from "./publicMenuBySlug";

// El cliente quiere: carta en fize.swal.network/{tienda}/menu, y que las
// recetas personales sean privadas al 100%. Este archivo fija ambas cosas.

describe("normalizeSlug", () => {
  it("pasa a minusculas y une con guiones", () => {
    expect(normalizeSlug("Sabor Paisa")).toBe("sabor-paisa");
  });

  it("quita acentos", () => {
    expect(normalizeSlug("Café-Bar")).toBe("cafe-bar");
  });

  it("colapsa espacios y simbolos raros", () => {
    expect(normalizeSlug("  La  Cevicheria!!! ")).toBe("la-cevicheria");
  });

  it("deja vacio un slug sin caracteres utiles", () => {
    expect(normalizeSlug("!!!")).toBe("");
    expect(normalizeSlug("")).toBe("");
  });
});

describe("findRestaurantBySlug", () => {
  const list = [
    { id: "r1", name: "Sabor Paisa", slug: "sabor-paisa" },
    { id: "r2", name: "La Cevichería", slug: "la-cevicheria" },
  ];

  it("encuentra por slug exacto", () => {
    expect(findRestaurantBySlug(list, "sabor-paisa")?.id).toBe("r1");
  });

  it("encuentra ignorando mayusculas, espacios y acentos", () => {
    expect(findRestaurantBySlug(list, "Sabor Paisa")?.id).toBe("r1");
    expect(findRestaurantBySlug(list, "la-cevicheria")?.id).toBe("r2");
    expect(findRestaurantBySlug(list, "LA CEVICHERIA")?.id).toBe("r2");
  });

  it("cae al id para los QR ya publicados con id", () => {
    expect(findRestaurantBySlug(list, "r1")?.id).toBe("r1");
  });

  it("devuelve null si no existe", () => {
    expect(findRestaurantBySlug(list, "no-existe")).toBeNull();
  });
});

describe("loadMenuBySlug", () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const adapter = getMemoryAdapter();
  const now = new Date().toISOString();

  async function seed() {
    await adapter.create("restaurant", {
      id: "r1",
      instance_id: "default",
      name: "Sabor Paisa",
      slug: "sabor-paisa",
      phone: "3001234567",
      address: "Cra 10 #20-30",
      created_at: now,
      updated_at: now,
    });
    await adapter.create("restaurant", {
      id: "r2",
      instance_id: "default",
      name: "Otro",
      slug: "otro",
      created_at: now,
      updated_at: now,
    });
    await adapter.create("category", {
      id: "c1",
      instance_id: "default",
      name: "Platos",
      created_at: now,
      updated_at: now,
    });
    await adapter.create("menuItem", {
      id: "m-publico",
      instance_id: "default",
      restaurantId: "r1",
      name: "Bandeja paisa",
      price: 32000,
      categoryId: "c1",
      isPublic: true,
      isAvailable: true,
      created_at: now,
      updated_at: now,
    });
    await adapter.create("menuItem", {
      id: "m-privado",
      instance_id: "default",
      restaurantId: "r1",
      name: "Receta secreta",
      price: 50000,
      categoryId: "c1",
      isPublic: false,
      isAvailable: true,
      created_at: now,
      updated_at: now,
    });
    await adapter.create("menuItem", {
      id: "m-agotado",
      instance_id: "default",
      restaurantId: "r1",
      name: "Sopa del dia",
      price: 12000,
      categoryId: "c1",
      isPublic: true,
      isAvailable: false,
      created_at: now,
      updated_at: now,
    });
  }

  it("devuelve la carta de la tienda pedida por slug", async () => {
    await seed();
    const m = await loadMenuBySlug(adapter, "default", "sabor-paisa");
    expect(m?.restaurant.name).toBe("Sabor Paisa");
    expect(m?.restaurant.phone).toBe("3001234567");
  });

  it("NO expone los platos marcados como privados", async () => {
    await seed();
    const m = await loadMenuBySlug(adapter, "default", "sabor-paisa");
    const names = m?.items.map((i) => i.name) ?? [];
    expect(names).toContain("Bandeja paisa");
    expect(names).not.toContain("Receta secreta");
  });

  it("NO expone los platos agotados", async () => {
    await seed();
    const m = await loadMenuBySlug(adapter, "default", "sabor-paisa");
    expect(m?.items.map((i) => i.name)).not.toContain("Sopa del dia");
  });

  it("solo devuelve las categorias que tienen platos publicos", async () => {
    await seed();
    const m = await loadMenuBySlug(adapter, "default", "sabor-paisa");
    expect(m?.categories.map((c) => c.id)).toEqual(["c1"]);
  });

  it("devuelve null para un slug inexistente", async () => {
    await seed();
    expect(await loadMenuBySlug(adapter, "default", "no-existe")).toBeNull();
  });

  it("no mezcla los platos de otra tienda", async () => {
    await seed();
    await adapter.create("menuItem", {
      id: "m-otro",
      instance_id: "default",
      restaurantId: "r2",
      name: "Plato ajeno",
      price: 1000,
      categoryId: "c1",
      isPublic: true,
      created_at: now,
      updated_at: now,
    });
    const m = await loadMenuBySlug(adapter, "default", "sabor-paisa");
    expect(m?.items.map((i) => i.name)).not.toContain("Plato ajeno");
  });

  it("nunca incluye campos de receta en la carta publica", async () => {
    await seed();
    await adapter.create("recipe", {
      id: "rec1",
      instance_id: "default",
      menuItemId: "m-publico",
      name: "Receta de la bandeja",
      yield: 4,
      lines: [],
      costTotal: 11800,
      costPerServing: 2950,
      prepTimeMin: 20,
      cookTimeMin: 30,
      totalTimeMin: 50,
      cookTempC: 200,
      visibility: "privada",
      steps: ["Sofirir"],
      createdAt: now,
      created_at: now,
      updated_at: now,
    });
    const m = await loadMenuBySlug(adapter, "default", "sabor-paisa");
    const raw = JSON.stringify(m);
    // Ningun campo de receta puede aparecer en la carta publica.
    for (const leak of [
      "costPerServing",
      "cookTimeMin",
      "cookTempC",
      "visibility",
      "steps",
      "yield",
    ]) {
      expect(raw).not.toContain(leak);
    }
  });
});

describe("privacidad de recetas", () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
  });

  const ctx = (req: Request) =>
    ({
      request: req,
      params: {},
      locals: {
        user: { id: "u1", email: "chef@fize.app", name: "C", role: "owner" },
      },
    }) as any;

  it("GET /api/recipes exige sesion: sin usuario responde 401", async () => {
    const sinSesion = {
      request: new Request("http://x/api/recipes"),
      params: {},
      locals: {},
    } as any;
    const res = await getRecipes(sinSesion);
    expect(res.status).toBe(401);
  });

  it("con sesion la ruta responde 200", async () => {
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();
    await adapter.create("menuItem", {
      id: "m9",
      instance_id: "default",
      name: "Plato",
      price: 1000,
      created_at: now,
      updated_at: now,
    });
    const res = await getRecipes(
      ctx(new Request("http://x/api/recipes")) as never,
    );
    expect(res.status).toBe(200);
  });

  it("POST /api/recipes exige sesion", async () => {
    const sinSesion = {
      request: new Request("http://x/api/recipes", { method: "POST" }),
      params: {},
      locals: {},
    } as any;
    const res = await createRecipe(sinSesion);
    expect(res.status).toBe(401);
  });
});

// Bug de produccion visto en fize.swal.network/restaurante-demo/menu: la carta
// renderizaba 10 platos en vez de 5, cada uno dos veces. Una segunda corrida
// del seed creo filas nuevas (ids distintos) con el mismo nombre y precio, y
// deduplicar por id no las detecta.
describe("dedupeMenuItems", () => {
  it("elimina platos repetidos aunque tengan ids distintos", () => {
    const rows = dedupeMenuItems([
      { id: "a1", restaurantId: "r1", name: "Bandeja paisa", price: 32000 },
      { id: "b2", restaurantId: "r1", name: "Bandeja paisa", price: 32000 },
      { id: "c3", restaurantId: "r1", name: "Limonada", price: 9000 },
      { id: "d4", restaurantId: "r1", name: "Limonada", price: 9000 },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("respeta dos platos con el mismo nombre y precios distintos", () => {
    // Si el restaurante subio el mismo plato a dos precios, son dos ofertas
    // reales: la deduplicacion no puede borrar oferta.
    const rows = dedupeMenuItems([
      { id: "a1", restaurantId: "r1", name: "Bandeja", price: 32000 },
      { id: "b2", restaurantId: "r1", name: "Bandeja", price: 28000 },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("no mezcla platos de dos restaurantes distintos", () => {
    const rows = dedupeMenuItems([
      { id: "a1", restaurantId: "r1", name: "Bandeja", price: 32000 },
      { id: "b2", restaurantId: "r2", name: "Bandeja", price: 32000 },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("no confunde mayusculas ni espacios al deduplicar", () => {
    const rows = dedupeMenuItems([
      { id: "a1", restaurantId: "r1", name: "Bandeja Paisa", price: 32000 },
      { id: "b2", restaurantId: "r1", name: "  bandeja paisa ", price: 32000 },
    ]);
    expect(rows).toHaveLength(1);
  });

  it("no toca una carta sin repetidos", () => {
    const rows = dedupeMenuItems([
      { id: "a1", restaurantId: "r1", name: "A", price: 1 },
      { id: "b2", restaurantId: "r1", name: "B", price: 2 },
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("desempate por slug con restaurantes duplicados", () => {
  it("prefiere el restaurante con phone cuando hay dos con el mismo slug", () => {
    const rSinPhone = {
      id: "r-sin-phone",
      name: "Demo",
      slug: "restaurante-demo",
      created_at: "2026-09-30T23:00:00.000Z",
    };
    const rConPhone = {
      id: "r-con-phone",
      name: "Demo",
      slug: "restaurante-demo",
      phone: "3001234567",
      created_at: "2026-10-01T02:00:00.000Z",
    };

    // El primero en la lista NO tiene phone, pero findRestaurantBySlug debe seleccionar el que SÍ tiene phone
    const res = findRestaurantBySlug(
      [rSinPhone, rConPhone],
      "restaurante-demo",
    );
    expect(res?.id).toBe("r-con-phone");
    expect(res?.phone).toBe("3001234567");
  });

  it("prefiere el restaurante con phone sin importar el orden en el arreglo", () => {
    const rConPhone = {
      id: "r-con-phone",
      name: "Demo",
      slug: "restaurante-demo",
      phone: "3001234567",
      created_at: "2026-09-30T23:00:00.000Z",
    };
    const rSinPhone = {
      id: "r-sin-phone",
      name: "Demo",
      slug: "restaurante-demo",
      created_at: "2026-10-01T02:00:00.000Z",
    };

    const res = findRestaurantBySlug(
      [rConPhone, rSinPhone],
      "restaurante-demo",
    );
    expect(res?.id).toBe("r-con-phone");
    expect(res?.phone).toBe("3001234567");
  });

  it("si ambos tienen phone o ninguno tiene phone, prefiere el mas antiguo por created_at", () => {
    const rAntiguo = {
      id: "r-antiguo",
      name: "Demo",
      slug: "restaurante-demo",
      phone: "3001111111",
      created_at: "2026-09-30T10:00:00.000Z",
    };
    const rNuevo = {
      id: "r-nuevo",
      name: "Demo",
      slug: "restaurante-demo",
      phone: "3002222222",
      created_at: "2026-10-01T10:00:00.000Z",
    };

    const res = findRestaurantBySlug([rNuevo, rAntiguo], "restaurante-demo");
    expect(res?.id).toBe("r-antiguo");
    expect(res?.phone).toBe("3001111111");
  });

  it("loadMenuBySlug resuelve la tienda con phone para construir la URL wa.me del CTA de WhatsApp", async () => {
    getMemoryAdapter().clear();
    const adapter = getMemoryAdapter();
    const now = new Date().toISOString();

    // 1) Se crea restaurante sin telefono (reproducion del bug en produccion)
    await adapter.create("restaurant", {
      id: "r-sin-phone",
      instance_id: "default",
      name: "Restaurante Demo",
      slug: "restaurante-demo",
      created_at: "2026-10-01T02:10:38.722Z",
      updated_at: now,
    });
    // 2) Se crea restaurante con telefono
    await adapter.create("restaurant", {
      id: "r-con-phone",
      instance_id: "default",
      name: "Restaurante Demo",
      slug: "restaurante-demo",
      phone: "3001234567",
      created_at: "2026-09-30T23:16:22.221Z",
      updated_at: now,
    });

    const m = await loadMenuBySlug(adapter, "default", "restaurante-demo");
    expect(m?.restaurant.id).toBe("r-con-phone");
    expect(m?.restaurant.phone).toBe("3001234567");

    // Verifica la construccion del enlace wa.me para WhatsApp CTA
    const waUrl = `https://wa.me/57${m?.restaurant.phone}`;
    expect(waUrl).toBe("https://wa.me/573001234567");
  });
});


describe("sanitizePublicDescription", () => {
  it("deja pasar una descripcion comercial normal", () => {
    expect(sanitizePublicDescription("Bandeja paisa con patacones")).toBe(
      "Bandeja paisa con patacones",
    );
  });

  it("descarta la descripcion si menciona produccion interna", () => {
    // Este es el texto exacto que se colaba en la carta publica.
    expect(sanitizePublicDescription("Empanadas de carne — receta aplicada al inventario")).toBeUndefined();
  });

  it.each(["receta", "inventario", "costo", "proveedor", "compras"])(
    "descarta si la descripcion dice %s",
    (palabra) => {
      expect(sanitizePublicDescription(`Plato con ${palabra} especial`)).toBeUndefined();
    },
  );

  it("no filtra a medias: descarta la frase entera, no un trozo", () => {
    const r = sanitizePublicDescription("Bandeja paisa — receta aplicada al inventario");
    expect(r).toBeUndefined();
  });

  it("devuelve undefined para valores que no son string", () => {
    expect(sanitizePublicDescription(undefined)).toBeUndefined();
    expect(sanitizePublicDescription(null)).toBeUndefined();
    expect(sanitizePublicDescription(42)).toBeUndefined();
    expect(sanitizePublicDescription("   ")).toBeUndefined();
  });

  it("recorta los espacios sobrantes de una descripcion valida", () => {
    expect(sanitizePublicDescription("  Limonada de menta  ")).toBe("Limonada de menta");
  });
});

describe("la carta publica nunca filtra produccion interna", () => {
  const adapter = (rows: Record<string, string | boolean | number>[]) => ({
    list: async (entity: string) => {
      if (entity === "restaurant") return [{ id: "r1", name: "Demo", slug: "demo", phone: "3001234567" }];
      if (entity === "category") return [{ id: "c1", name: "Entradas" }];
      if (entity === "menuItem") return rows as never;
      return [];
    },
  });

  it("omite la descripcion interna del plato pero conserva el plato", async () => {
    const data = await loadMenuBySlug(adapter([
      { id: "m1", restaurantId: "r1", name: "Empanadas de carne", price: 12000,
        categoryId: "c1", description: "receta aplicada al inventario" },
    ]), "default", "demo");
    expect(data?.items).toHaveLength(1);
    expect(data?.items[0].name).toBe("Empanadas de carne");
    expect(data?.items[0].description).toBeUndefined();
  });

  it("conserva la descripcion comercial cuando no hay fuga", async () => {
    const data = await loadMenuBySlug(adapter([
      { id: "m2", restaurantId: "r1", name: "Limonada", price: 5000,
        categoryId: "c1", description: "Con menta fresca" },
    ]), "default", "demo");
    expect(data?.items[0].description).toBe("Con menta fresca");
  });
});
