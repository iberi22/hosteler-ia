/**
 * QR Code SVG Sanitizer
 * Pure-function sanitizer and validator for SVG strings generated for QR codes.
 * Asserts that SVG content strictly follows safe SVG structure and contains
 * no executable scripts, inline event handlers, or malicious URIs.
 */

export function assertSafeSvg(svg: string): string {
  if (typeof svg !== 'string' || !svg.trim()) {
    throw new Error('Invalid SVG: input must be a non-empty string');
  }

  const trimmed = svg.trim();
  const lower = trimmed.toLowerCase();

  if (!lower.startsWith('<svg') || !lower.endsWith('</svg>')) {
    throw new Error('Invalid SVG: must start with <svg and end with </svg>');
  }

  if (/<script\b/i.test(trimmed)) {
    throw new Error('Unsafe SVG: contains script tag');
  }

  if (/\bon\w+\s*=/i.test(trimmed)) {
    throw new Error('Unsafe SVG: contains inline event handler');
  }

  if (/javascript\s*:/i.test(trimmed)) {
    throw new Error('Unsafe SVG: contains javascript URI');
  }

  return svg;
}
