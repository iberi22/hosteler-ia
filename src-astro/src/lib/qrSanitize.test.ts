import { describe, it, expect } from 'vitest';
import qrcode from 'qrcode-generator';
import { assertSafeSvg } from './qrSanitize';

describe('assertSafeSvg', () => {
  it('accepts valid SVG output from qrcode-generator', () => {
    const qr = qrcode(0, 'M');
    qr.addData('https://fize.app/table/123');
    qr.make();
    const svg = qr.createSvgTag({ scalable: true });

    const result = assertSafeSvg(svg);
    expect(result).toBe(svg);
    expect(result.toLowerCase().startsWith('<svg')).toBe(true);
    expect(result.toLowerCase().endsWith('</svg>')).toBe(true);
  });

  it('rejects SVG containing <script> tags', () => {
    const maliciousSvg = '<svg><script>alert("xss")</script></svg>';
    expect(() => assertSafeSvg(maliciousSvg)).toThrow('Unsafe SVG: contains script tag');
  });

  it('rejects SVG containing onload= or other event handlers', () => {
    const maliciousSvg = '<svg onload="alert(1)"><rect width="10" height="10"/></svg>';
    expect(() => assertSafeSvg(maliciousSvg)).toThrow('Unsafe SVG: contains inline event handler');
  });

  it('rejects SVG containing javascript: URIs', () => {
    const maliciousSvg = '<svg><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>';
    expect(() => assertSafeSvg(maliciousSvg)).toThrow('Unsafe SVG: contains javascript URI');
  });

  it('rejects strings that do not start with <svg or end with </svg>', () => {
    expect(() => assertSafeSvg('<div>not an svg</div>')).toThrow('Invalid SVG');
    expect(() => assertSafeSvg('<svg><rect width="10" height="10"/>')).toThrow('Invalid SVG');
    expect(() => assertSafeSvg('')).toThrow('Invalid SVG');
  });
});
