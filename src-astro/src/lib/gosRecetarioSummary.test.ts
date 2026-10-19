import { describe, it, expect } from 'vitest';
import { buildImportSummary } from './gosRecetarioSummary';

describe('buildImportSummary', () => {
  it('returns empty string for no rows', () => {
    expect(buildImportSummary([])).toBe('');
  });

  it('returns empty string for only pending rows', () => {
    expect(buildImportSummary([{ status: 'pending', unmatched: [] }])).toBe('');
  });

  it('returns summary for only a skipped row', () => {
    expect(buildImportSummary([{ status: 'skipped', unmatched: [] }])).toContain('Importadas 0 receta(s), omitidas 1');
  });

  it('returns summary for one success then one skipped', () => {
    expect(buildImportSummary([
      { status: 'success', unmatched: [] },
      { status: 'skipped', unmatched: [] }
    ])).toContain('Importadas 1 receta(s), omitidas 1');
  });

  it('does not return summary for lone error row, but counts it when success is present', () => {
    // Lone error
    expect(buildImportSummary([{ status: 'error', unmatched: [] }])).toBe('');

    // Error plus success
    expect(buildImportSummary([
      { status: 'error', unmatched: [] },
      { status: 'success', unmatched: [] }
    ])).toContain('omitidas 1');
  });

  it('deduplicates unmatched ingredients and keeps first-seen order; none gives ninguno', () => {
    // none gives ninguno
    expect(buildImportSummary([{ status: 'success', unmatched: [] }])).toContain('ingredientes sin insumo: ninguno');

    // deduplicates and keeps first-seen order
    expect(buildImportSummary([
      { status: 'success', unmatched: ['B', 'A'] },
      { status: 'skipped', unmatched: ['C', 'A', 'B'] }
    ])).toContain('ingredientes sin insumo: B, A, C');
  });

  it('returns the exact string for a mixed case', () => {
    const result = buildImportSummary([
      { status: 'success', unmatched: ['Harina'] },
      { status: 'skipped', unmatched: [] },
      { status: 'error', unmatched: ['Sal', 'Harina'] },
      { status: 'pending', unmatched: ['Azucar'] } // pending shouldn't count
    ]);

    expect(result).toBe('Importadas 1 receta(s), omitidas 2, ingredientes sin insumo: Harina, Sal, Azucar');
  });
});
