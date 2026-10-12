# Hosteler-IA - SWAL Agent Directives & Repository Guide

## Sovereign Work & Autonomous Living (SWAL) Ecosystem Alignment

This repository is part of the **Sovereign Work & Autonomous Living (SWAL)** ecosystem, aiming to provide sovereign, decentralised, and self-hosted tools for hospitality and local business operations.

### Core Ecosystem Principles
1. **Sovereignty**: Complete local control over data, logic, and infrastructure without vendor lock-in.
2. **Autonomous Operation**: SWAL Pro nodes run locally and offline-first without reliance on central paywalls or proprietary cloud gateways.
3. **Decentralized Mesh**: Interoperability across SWAL nodes via standardized RPCs, webhooks, and secure agent communication channels.

### SWAL GOAL
The overarching goal of the SWAL project is to empower local businesses, workers, and individuals through sovereign software architecture, offline capability, AI assistance, and open standards.

### PROJECT MAP
- **Core Repository**: `hosteler-ia` (Hospitality Management Sovereign Node)
- **Agent Framework & Orchestration**: Xavier Agent Ecosystem (namespace: `apps/xavier`)
- **Metadata & Git Automation**: GitCore tooling (`.gitcore/`)

## Guidelines for AI Agents & Developers

### Code & Engineering Directives
- **Type Safety**: TypeScript strict mode enabled. Never use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- **Package Manager**: Always use `pnpm` (`pnpm run check`, `pnpm test`, etc.).
- **Linting & Formatting**: Biome is the canonical check tool (`pnpm run check`).
- **Database**: Cloudflare D1 through `src-astro/src/lib/storageAdapter.ts`. Migrations are `src-astro/migrations/001_vault.sql` through `005_auth_rate_limit.sql` (the billing tables of the optional cloud module live in `private/cloud/src-astro/migrations/`). Do not run Prisma. `prisma.config.ts` is not in the repo. `src-astro/prisma/schema.prisma` is a retired PostgreSQL schema (`provider = "postgresql"`), not the runtime.
- **App runtime**: Astro 7 (`astro` ^7.3.1) and Svelte 5 (`svelte` ^5.57.0) on a Cloudflare Worker (`@astrojs/cloudflare` ^14.3.0, `@astrojs/svelte` ^9.0.1). The application lives in `src-astro/`. There is no Next.js App Router and no `next/headers`.
- **Accessibility**: UI components must comply with WCAG 2.2 AA standards and maintain a minimum contrast ratio of 4.5:1.

### Documentation & Standards Checklist
For any modifications or additions, maintain the 10 SWAL documentation standards:
1. `README.md` - SWAL identity, Pro = sovereign node.
2. `AGENTS.md` - Agent directives, GOAL, PROJECT_MAP, Xavier ns (`apps/xavier`).
3. `SRC.md` - Complete source structure mapping.
4. `docs/SRS/REQUIREMENTS.md` - REQ-NNN structured requirements.
5. `.gitcore/docs/SWAL_GOAL.md` - Local copy of SWAL canonical goal.
6. Feature ledger (`features.json`) - kept in the private repo (`private/gitcore/`), not in the public tree.
7. `LICENSE` - AGPL-3.0-only license text.
8. `CLA.md` - Contributor License Agreement.
9. `SECURITY.md` - SWAL Security Policy.
10. `CONTRIBUTING.md` - Guidelines for contributing to SWAL.

<!-- SWAL-ROUTING-START -->
## SWAL Routing Minimalista (SDD Hibrido F1)
> Antes de crear `.gitcore/sdd/` aplica routing organico (gentle-ai v2.3.0).
> - **Direct inline**: 1-3 files trivial -> inline sin delegar, sin SDD
> - **Delegated direct**: 4+ files o 2+ non-trivial -> delegate_task con Xavier skill search, sin SDD
> - **Optional SDD**: ambiguedad alta -> proponer SDD opcional, si SI crear `.gitcore/sdd/specs/###-feat/onepage.md` (1 pagina spec P1 + plan HOW minimo + tasks [P])
> Ver skill `sdd-hibrido` (`~/.hermes/skills/sdd-hibrido/references/routing.md`). `rm -rf .gitcore/sdd` limpia sin tocar features.json.
<!-- SWAL-ROUTING-END -->

<!-- SWAL-REGISTRY-START -->
## Skill Registry + Xavier Indexer (F1b)
> Skills viven FUERA de `.gitcore` (global `~/.hermes/skills` + proyecto `.skills/`). GitCore solo referencia via `.atl/skill-registry.md` + cache `.skill-registry.cache.json` y opcional `.gitcore/skill-registry.json`.
> - Refresh: `~/.hermes/scripts/skill-registry-refresh.sh --cwd <proyecto>`
> - Index: `~/.hermes/scripts/xavier-index-skills.sh --cwd <proyecto>` (Xavier tags [skill])
> - Antes de delegar: `xavier_search(tags=[skill]) -> skill_view(paths)`
> Ver skills `skill-registry` y `xavier-skill-indexer`.
<!-- SWAL-REGISTRY-END -->

<!-- SWAL-SDD-START -->
## SDD One-Page + SRS Mapping
> Spec efimero `.gitcore/sdd/specs/###-feat/onepage.md` referencia `REQ-xxx` durable de `docs/SRS/REQUIREMENTS.md` (IEEE 830 reduced). Drift detector `srs-src-drift-detector` mantiene traceabilidad. Docs humanos estables en `docs/`, specs AI en `.gitcore/sdd/` aislado.
<!-- SWAL-SDD-END -->
