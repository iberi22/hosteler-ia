# Software Requirements Specification (SRS) - Hosteler-IA

## 1. Introduction

Hosteler-IA is a sovereign hospitality node within the Sovereign Work & Autonomous Living (SWAL) ecosystem. It provides real-time restaurant management, AI-driven inventory prediction, automated digital ordering, and PWA offline capability.

## 2. Requirements Specification

### 2.1 Functional Requirements

#### REQ-001: Offline-First Operation & Local Data Sync
- **Description**: The system must operate without continuous internet connectivity, storing transactions in local IndexedDB storage (`Dexie.js`) and synchronizing with the database upon network recovery via Service Workers (`sync-orders`).
- **Priority**: High
- **Verification**: Service worker background sync test & Dexie IndexedDB fallback verification.

#### REQ-002: Real-time Digital Ordering & QR Code Menu
- **Description**: Customers must be able to scan table-specific QR codes, access a digital menu, customize items with modifiers, and submit orders directly to the kitchen queue.
- **Priority**: High
- **Verification**: End-to-end order placement API & UI testing.

#### REQ-003: Inventory & Stock Management
- **Description**: The system shall track inventory items, ingredient stock levels, unit measures, and automatically deduct stock based on recipe mappings when orders are processed.
- **Priority**: High
- **Verification**: Inventory update trigger test on order state transitions.

#### REQ-004: Predictive AI Inventory Analytics
- **Description**: The system shall integrate AI prediction algorithms (via Cloudflare Workers AI `@cf/` models with local fallback) to forecast ingredient demand and generate proactive stock alerts.
- **Priority**: Medium
- **Verification**: Predictions API route contract testing and fallback behavior check.

#### REQ-005: Kitchen Display System (KDS) & Order Status Lifecycle
- **Description**: Kitchen staff must receive real-time order status updates (PENDING, IN_PREPARATION, READY, DELIVERED, CANCELLED) with websocket/Supabase realtime listeners.
- **Priority**: High
- **Verification**: Realtime order state event propagation test.

#### REQ-006: Sovereign Multi-Tenant Support
- **Description**: The platform must isolate tenant data per restaurant node, enforcing authorization checks and service role security boundaries across all REST endpoints.
- **Priority**: High
- **Verification**: Tenant isolation security tests on API routes.

#### REQ-007: Catálogo alimentario GOS y nutrición por porción
- **Description**: GOS será la única fuente de ingredientes alimentarios, platos, nutrientes, alérgenos y metadatos. Fize guarda referencias opcionales `gosIngredientId` y `gramsPerUnit` en el inventario operativo; los registros históricos permanecen válidos. La nutrición se deriva de las cantidades de receta, dividida por rendimiento, y muestra parcialidad cuando falten vínculos o datos. La carta publica solo totales y etiquetas positivas con identidad versionada del dataset, permite excluir alérgenos declarados y no expone recetas privadas. El fallo de GOS nunca bloquea pedidos.
- **Priority**: High
- **Verification**: Vitest con fixtures reales recortados: conversión, agregación, alérgenos, IndexedDB offline, timeout y persistencia/migración de inventario; Playwright de carta y pedidos.

### 2.2 Non-Functional Requirements

#### REQ-101: Web Accessibility (WCAG 2.2 AA)
- **Description**: All user interfaces in light and dark mode must comply with WCAG 2.2 AA standards, ensuring keyboard navigation and a minimum text contrast ratio of 4.5:1.
- **Priority**: High
- **Verification**: Biome check & automated accessibility audit.

#### REQ-102: Performance & Load Times
- **Description**: Largest Contentful Paint (LCP) must be under 2.5 seconds, First Input Delay (FID) under 100ms, and Cumulative Layout Shift (CLS) under 0.05.
- **Priority**: High
- **Verification**: Lighthouse performance audits.

#### REQ-103: Internationalization (i18n)
- **Description**: The system must support multi-language routing (`next-intl`), detecting user locale and serving messages from localized JSON dictionaries.
- **Priority**: Medium
- **Verification**: Locale header detection test in middleware/layout.
