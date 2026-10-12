# PRISMA MIGRATION NOTES

## Current state
- 15 models in `schema.prisma`
- Database: PostgreSQL (via `prisma generate` → @prisma/client)
- Last used: 2026-09-03

## Models
- Restaurant — tenant root
- Table — physical tables with QR codes
- MenuCategory, MenuItem, RecipeItem — menu hierarchy
- UserProfile — users (staff, customer)
- Order, OrderItem — orders
- InventoryItem, InventoryTransaction, InventoryPrediction, PurchaseSuggestion — inventory
- AIRecommendation, AIAnalytics — AI features
- CustomerProfile — customer behavior

## Migration plan
- Phase 1 (current): Prisma still used by root `src/`
- Phase 2 (after src/ removal): move to `src-astro/prisma/`
- Phase 3 (F3 SurrealDB): port to SurrealDB (internal plan, not published)

## Mapping (Prisma → SurrealDB)
- `id: String` → SurrealDB `record::id("table")`
- `createdAt/updatedAt: DateTime` → SurrealDB `<datetime>`
- relations → SurrealDB `record_link` / `array`
- enums → SurrealDB `string` with CHECK constraints
