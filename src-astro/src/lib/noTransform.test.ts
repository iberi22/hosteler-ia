import { describe, it, expect } from 'vitest';
import { withNoTransform, isHtml } from './noTransform';

describe('no-transform (sin analitica inyectada por Cloudflare)', () => {
  it('anade la directiva sin perder las existentes ni duplicarla', () => {
    expect(withNoTransform(null)).toBe('no-transform');
    expect(withNoTransform('')).toBe('no-transform');
    expect(withNoTransform('private, no-store')).toBe('private, no-store, no-transform');
    expect(withNoTransform('public, No-Transform')).toBe('public, No-Transform');
  });

  it('solo se aplica al HTML', () => {
    expect(isHtml('text/html; charset=utf-8')).toBe(true);
    expect(isHtml('application/json')).toBe(false);
    expect(isHtml(null)).toBe(false);
  });
});
