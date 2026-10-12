import { describe, expect, test } from "vitest";
import { domainConfig } from "./domain.config";

describe("Hosteler Domain Configuration", () => {
  test("should have correct app identity", () => {
    expect(domainConfig.appId).toBe("hosteler-ia");
    expect(domainConfig.appName).toBe("Fi'ze Hosteler-IA");
    expect(domainConfig.instanceId).toBe("default");
  });

  // El numero es una guardia de inventario, no una regla: cuando se registra una
  // entidad nueva hay que subirlo aqui. Subirlo sin anadirla a `names` si que
  // romperia la segunda mitad del test (que exige xavierKind en todas), pero
  // bajar el numero para "arreglar" el test dejaria una entidad sin revisar.
  // Ultimo alta: `notification` (avisos read/unread del panel, 2026-10-05).
  test("should include all 14 hosteler entities with xavierKind", () => {
    expect(domainConfig.entities).toHaveLength(14);
    const names = domainConfig.entities.map((e: any) => e.name);
    expect(names).toContain("restaurant");
    expect(names).toContain("table");
    expect(names).toContain("menuItem");
    expect(names).toContain("category");
    expect(names).toContain("order");
    expect(names).toContain("payment");
    expect(names).toContain("inventoryItem");
    expect(names).toContain("inventoryTx");
    expect(names).toContain("supplier");
    expect(names).toContain("purchase");
    expect(names).toContain("recipe");
    expect(names).toContain("notification");
    // All entities must have xavierKind for agentic memory
    for (const entity of domainConfig.entities) {
      expect((entity as any).xavierKind).toBeTruthy();
    }
  });

  test("should have AUI and billing config", () => {
    expect(domainConfig.aui).toBeDefined();
    expect(domainConfig.aui.enabled).toBe(true);
    expect(domainConfig.billing).toBeDefined();
    expect(domainConfig.billing.tier).toBe("socio");
  });
});
