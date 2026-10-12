# SWAL Security Policy (SECURITY.md)

## Supported Versions

Only the latest release and active development branch of Hosteler-IA within the SWAL ecosystem receive security updates.

| Version | Supported          |
| ------- | ------------------ |
| Main    | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The SWAL ecosystem takes software security, tenant isolation, and sovereign data privacy seriously.

### How to Report

If you discover a security vulnerability or sensitive privilege escalation risk in `hosteler-ia`:

1. **Do NOT open a public GitHub issue.**
2. Send an encrypted email or disclosure report to `security@swal.ecosystem` (or contact the SWAL maintainers via private channels).
3. Include:
   - Detailed description of the vulnerability and potential impact.
   - Step-by-step proof of concept (PoC) or reproduction steps.
   - Affected API endpoints, client routes, or background synchronization workers.

### Security Principles & Code Guardrails
- **No Client-Trusted Pricing**: Server routes recalculate order totals independently from database prices.
- **Service Role Boundaries**: API routes using Supabase service role keys enforce explicit multi-tenant authorization checks.
- **Type Safety**: The repository strictly forbids `as any`, `@ts-ignore`, or `@ts-expect-error`.

### Response Timeline
- **Acknowledgement**: Within 48 hours.
- **Assessment & Fix Plan**: Within 5 business days.
- **Patch Release**: Released as a priority hotfix commit and advisory update.
