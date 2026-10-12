# SWAL Contributing Guidelines (CONTRIBUTING.md)

Welcome to the Sovereign Work & Autonomous Living (SWAL) community! We welcome contributions to `hosteler-ia` that promote sovereign, decentralised, and autonomous hospitality operations.

## Code of Conduct

We expect all contributors to adhere to SWAL community values: respect, open collaboration, security responsibility, and dedication to open-source software sovereignty.

## How to Contribute

1. **Fork the Repository**: Create a personal fork of `hosteler-ia`.
2. **Create a Feature Branch**: Use descriptive branch names (e.g., `feat/offline-order-queue` or `docs-standard-hosteler-ia`).
3. **Follow Coding Standards**:
   - **Package Manager**: Use `pnpm` exclusively.
   - **Type Safety**: Maintain strict TypeScript typing. Never use `as any`, `@ts-ignore`, or `@ts-expect-error`.
   - **Linting & Code Checks**: Target specific modified files with Biome (`npx @biomejs/biome check --write <file>`) or run `pnpm run check`.
   - **Accessibility**: UI components must satisfy WCAG 2.2 AA standards (minimum 4.5:1 text contrast).
   - **Conventional Commits**: Format commit messages as `type(scope): message` (e.g., `feat(inventory): add low stock alert hook`).
4. **Run Unit Tests**: Run `pnpm test` (Vitest) to verify that all unit and integration tests pass without errors.
5. **Documentation**: Update `README.md`, `SRC.md`, `AGENTS.md`, or `docs/SRS/REQUIREMENTS.md` if your change modifies architecture, API endpoints, or requirements.
6. **Submit a Pull Request**: Submit your PR targeting the main/development branch with a clear summary of changes and testing proof.

## Contributor License Agreement (CLA)

By contributing to this repository, you agree to the terms outlined in `CLA.md` and acknowledge that software is licensed under **AGPL-3.0-only**.
