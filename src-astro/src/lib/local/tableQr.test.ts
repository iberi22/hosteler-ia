import { describe, it, expect } from 'vitest';
import { resolveTableQrUrl } from './tableQr';

// QA pre-entrega 2026-10-13 #4: el QR de /local/mesas apuntaba al equipo del duenno.
describe('resolveTableQrUrl', () => {
  it('modo local publicado: enlace publico de la carta con la mesa', () => {
    expect(resolveTableQrUrl({ local: true, table: { number: 3 }, slug: 'dona-rosa', published: true })).toBe(
      'https://fize.swal.network/dona-rosa/menu?mesa=3',
    );
  });

  it('modo local sin publicar: sin QR (la pantalla manda a Publicar)', () => {
    expect(resolveTableQrUrl({ local: true, table: { number: 3 }, slug: 'dona-rosa', published: false })).toBeNull();
    expect(resolveTableQrUrl({ local: true, table: { number: 3 }, published: true })).toBeNull();
    // El qrCode interno NO se usa en modo local: no es una URL que el comensal pueda abrir.
    expect(
      resolveTableQrUrl({ local: true, table: { number: 1, qrCode: 'mv6j956n-5ct119' }, slug: 'x', published: false }),
    ).toBeNull();
  });

  it('dashboard servido: la ruta /table/<qrCode> del propio origen', () => {
    expect(
      resolveTableQrUrl({
        local: false,
        table: { number: 1, qrCode: 'abc123' },
        origin: 'http://localhost:4331',
      }),
    ).toBe('http://localhost:4331/table/abc123');
    expect(resolveTableQrUrl({ local: false, table: { number: 1, qrCode: 'abc123' } })).toBe('/table/abc123');
  });

  it('sin mesa no hay QR', () => {
    expect(resolveTableQrUrl({ local: true, table: null, slug: 'x', published: true })).toBeNull();
    expect(resolveTableQrUrl({ local: false, table: null })).toBeNull();
  });
});
