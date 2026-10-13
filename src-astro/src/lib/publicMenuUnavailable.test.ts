import { describe, it, expect } from 'vitest';
import { publicMenuUnavailableHtml, PUBLIC_MENU_UNPUBLISHED_TITLE } from './publicMenuUnavailable';

// QA pre-entrega 2026-10-13 #5: el comensal veia un 404 en crudo y el duenno un mensaje
// distinto del que /local/publicar le habia prometido.
describe('publicMenuUnavailableHtml', () => {
  it('muestra el aviso que el duenno espera', () => {
    const html = publicMenuUnavailableHtml('sazon-paisa');
    expect(html).toContain(PUBLIC_MENU_UNPUBLISHED_TITLE);
    expect(html).toContain('Esta carta todavía no está publicada');
    expect(html).toContain('/sazon-paisa/menu');
    // Salidas utiles: publicar y revisar el enlace.
    expect(html).toContain('Publicar');
    expect(html).toContain('código QR de la mesa');
  });

  it('no habla de "no encontramos" como si la carta no existiera', () => {
    expect(publicMenuUnavailableHtml('x')).not.toContain('No encontramos esa carta');
  });

  it('escapa el slug: viene de la URL', () => {
    const html = publicMenuUnavailableHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('es un documento completo', () => {
    const html = publicMenuUnavailableHtml('x');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trim().endsWith('</html>')).toBe(true);
  });
});
