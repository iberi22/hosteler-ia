export function buildImportSummary(items: Array<{ status: 'pending' | 'success' | 'error' | 'skipped'; unmatched: string[] }>): string {
  const hasResolved = items.some(i => i.status === 'success' || i.status === 'skipped');
  if (!hasResolved) {
    return '';
  }

  let successCount = 0;
  let errorCount = 0;
  const allUnmatched = new Set<string>();

  for (const item of items) {
    if (item.status === 'success') {
      successCount++;
    } else if (item.status === 'error' || item.status === 'skipped') {
      errorCount++;
    }

    for (const u of item.unmatched) {
      allUnmatched.add(u);
    }
  }

  const unmatchedStr = allUnmatched.size > 0 ? Array.from(allUnmatched).join(', ') : 'ninguno';

  return `Importadas ${successCount} receta(s), omitidas ${errorCount}, ingredientes sin insumo: ${unmatchedStr}`;
}
