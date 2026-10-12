import { describe, it, expect } from 'vitest';
import { validateWhatsapp } from './restaurantRules';

describe('validateWhatsapp', () => {
  it('normaliza formatos habituales a digitos con indicativo', () => {
    for (const raw of ['+57 300 123 4567', '3001234567', '300-123-4567', '(300) 123 4567', '573001234567']) {
      expect(validateWhatsapp(raw)).toEqual({ ok: true, phone: '573001234567' });
    }
  });

  it('vacio es valido (campo opcional)', () => {
    expect(validateWhatsapp('   ')).toEqual({ ok: true, phone: '' });
  });

  it('rechaza numeros demasiado cortos, largos o sin digitos con mensaje en español', () => {
    for (const raw of ['12345', '300 123 456', '+57 300 123 45678', 'abc']) {
      const r = validateWhatsapp(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/WhatsApp/);
    }
  });
});

import { validateSlug, suggestSlug, isSlugTaken, RESERVED_SLUGS } from './restaurantRules';

describe('validateSlug', () => {
  it('acepta slugs bien formados', () => {
    for (const s of ['abc', 'la-trattoria', 'bistro-21', 'a1b2']) expect(validateSlug(s)).toBeNull();
  });

  it('rechaza formato invalido', () => {
    for (const s of ['La-Trattoria', 'el sazon', 'sazón', '-abc', 'abc-', 'a--b', 'a_b', 'ab.c']) {
      expect(validateSlug(s), s).not.toBeNull();
    }
  });

  it('exige entre 3 y 60 caracteres', () => {
    expect(validateSlug('ab')).toMatch(/entre 3 y 60/);
    expect(validateSlug('a'.repeat(61))).toMatch(/entre 3 y 60/);
    expect(validateSlug('a'.repeat(60))).toBeNull();
  });

  it('rechaza palabras reservadas', () => {
    for (const s of ['api', 'dashboard', 'login', 'register', 'offline', 'checkout', 'table', 'menu', 'pair', 'order-confirmation', 'admin', 'static']) {
      expect(validateSlug(s), s).toMatch(/reservada/);
    }
    expect(RESERVED_SLUGS.has('_astro')).toBe(true);
  });
});

describe('suggestSlug', () => {
  it('quita tildes, pasa a minusculas y usa guiones', () => {
    expect(suggestSlug("El Sazón de la Abuela")).toBe('el-sazon-de-la-abuela');
    expect(suggestSlug("  Ñandú & Café #1!  ")).toBe('nandu-cafe-1');
  });

  it('respeta el maximo sin dejar guion final', () => {
    const s = suggestSlug(`${'a'.repeat(59)} bbb`);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('isSlugTaken', () => {
  const adapter = {
    list: async () => [
      { id: '1', slug: 'uno' },
      { id: '2', slug: 'dos', deleted_at: '2026-01-01' },
    ],
  };
  it('ignora borrados y el propio registro', async () => {
    expect(await isSlugTaken(adapter, 'x', 'uno')).toBe(true);
    expect(await isSlugTaken(adapter, 'x', 'uno', '1')).toBe(false);
    expect(await isSlugTaken(adapter, 'x', 'dos')).toBe(false);
  });
});
