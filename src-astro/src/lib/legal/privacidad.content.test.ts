import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/pages/privacidad.astro', 'utf8');
const text = src.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('privacidad.astro (Ley 1581 de 2012, Decreto 1377 de 2013)', () => {
  it('responsable: domicilio y telefono como TODO-OWNER', () => {
    // Assert against raw src: stripped text has no tag boundaries, so [^<]* could
    // match a later 'domicilio'/'telefono' anywhere on the page.
    expect(src).toMatch(/Domicilio:\s*<span class="todo">TODO-OWNER:[^<]*domicilio/i);
    expect(src).toMatch(/Tel[eé]fono:\s*<span class="todo">TODO-OWNER:[^<]*tel[eé]fono/i);
    expect(text).toMatch(/TODO-OWNER: raz[oó]n social y NIT/);
    expect(text).toMatch(/TODO-OWNER: correo de privacidad/);
  });

  it('derechos del titular: lista completa del art. 8', () => {
    for (const phrase of [
      'Conocer, actualizar y rectificar',
      'prueba de la autorización',
      'ser informado',
      'queja',
      'Superintendencia de Industria y Comercio',
      'Revocar la autorización',
      'supresión',
      'gratuita',
    ]) {
      expect(text.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it('procedimiento con plazos', () => {
    expect(text).toMatch(/10 días hábiles/);
    expect(text).toMatch(/5 días hábiles más/);
    expect(text).toMatch(/15 días hábiles/);
    expect(text).toMatch(/8 días hábiles más/);
    expect(text).toMatch(/TODO-OWNER: canal/);
  });

  it('transferencia/transmision internacional a Cloudflare, Inc.', () => {
    expect(text).toContain('Cloudflare, Inc.');
    expect(text).toContain('Estados Unidos');
    expect(text).toMatch(/transmisión internacional/i);
    expect(text).toMatch(/garant[ií]as/i);
  });

  it('comensales: restaurante responsable, SWAL encargado', () => {
    expect(text).toContain('comensales');
    expect(text).toMatch(/restaurante es el responsable/);
    expect(text).toMatch(/SWAL actúa como encargado/);
    expect(text).toMatch(/WhatsApp/);
  });

  it('vigencias', () => {
    expect(text).toMatch(/Vigencia de la política/);
    expect(text).toContain('2026-10-21');
    expect(text).toMatch(/Vigencia de la base de datos/);
    expect(src).toMatch(/Vigencia de la base de datos:<\/strong>\s*<span class="todo">TODO-OWNER:[^<]*vigencia de la base de datos/i);
  });

  it('sin ARCO ni promesa de cifrado extremo a extremo', () => {
    expect(src).not.toMatch(/ARCO/);
    expect(src).not.toMatch(/extremo a extremo/i);
    expect(src).not.toMatch(/end-to-end|E2EE/i);
  });
});
