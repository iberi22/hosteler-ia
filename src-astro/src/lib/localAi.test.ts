import { describe, it, expect, vi } from 'vitest';
import { detectLocalAiTier, promptApiState, rulesRecommendations, localInfer, type PromptApiLike } from './localAi';
import { parseRecommendations } from './recommendations';

describe('localAi', () => {
  describe('tier detection', () => {
    it('returns undefined state and rules tier with no API', async () => {
      const env = { languageModel: undefined };
      expect(await promptApiState(env)).toBeUndefined();
      expect(await detectLocalAiTier(env)).toBe('rules');
    });

    it('returns rules tier on available rejection', async () => {
      const languageModel = {
        availability: vi.fn().mockRejectedValue(new Error('fail')),
        create: vi.fn(),
      } as unknown as PromptApiLike;
      const env = { languageModel };
      expect(await promptApiState(env)).toBeUndefined();
      expect(await detectLocalAiTier(env)).toBe('rules');
    });

    it('returns prompt-api tier when readily', async () => {
      const languageModel = {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn(),
      } as unknown as PromptApiLike;
      const env = { languageModel };
      expect(await promptApiState(env)).toBe('readily');
      expect(await detectLocalAiTier(env)).toBe('prompt-api');
    });

    it('returns prompt-api tier when available', async () => {
      const languageModel = {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn(),
      } as unknown as PromptApiLike;
      const env = { languageModel };
      expect(await promptApiState(env)).toBe('available');
      expect(await detectLocalAiTier(env)).toBe('prompt-api');
    });

    it('returns rules tier when downloadable', async () => {
      const languageModel = {
        availability: vi.fn().mockResolvedValue('downloadable'),
        create: vi.fn(),
      } as unknown as PromptApiLike;
      const env = { languageModel };
      expect(await promptApiState(env)).toBe('downloadable');
      expect(await detectLocalAiTier(env)).toBe('rules');
    });

    it('returns rules tier when after-download', async () => {
      const languageModel = {
        availability: vi.fn().mockResolvedValue('after-download'),
        create: vi.fn(),
      } as unknown as PromptApiLike;
      const env = { languageModel };
      expect(await promptApiState(env)).toBe('after-download');
      expect(await detectLocalAiTier(env)).toBe('rules');
    });
  });

  describe('rulesRecommendations', () => {
    it('provides restock and promo from valid prompt', () => {
      const prompt = `Restaurante: Test
Pedidos pendientes: 0
Stock bajo: Harina (2), Azucar (1)
Top ventas: Tortilla x3`;
      const json = rulesRecommendations(prompt);
      const parsed = parseRecommendations(json);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Harina');
      expect(parsed[1].type).toBe('restock');
      expect(parsed[1].title).toBe('Reponer Azucar');
      expect(parsed[2].type).toBe('promo');
      expect(parsed[2].title).toBe('Promocionar Tortilla');
    });

    it('handles decimal and negative numbers in stock and sales', () => {
      const prompt = `Restaurante: Test
Pedidos pendientes: 0
Stock bajo: Harina (2.5), Leche (0,5), Queso (-1)
Top ventas: Tortilla x3.14`;
      const json = rulesRecommendations(prompt);
      const parsed = parseRecommendations(json);
      expect(parsed).toHaveLength(4);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Harina');
      expect(parsed[1].type).toBe('restock');
      expect(parsed[1].title).toBe('Reponer Leche');
      expect(parsed[2].type).toBe('restock');
      expect(parsed[2].title).toBe('Reponer Queso');
      expect(parsed[3].type).toBe('promo');
      expect(parsed[3].title).toBe('Promocionar Tortilla');
    });

    it('does not split items incorrectly on commas in names', () => {
      const prompt = `Restaurante: Test
Pedidos pendientes: 0
Stock bajo: Tarta, grande (2)
Top ventas: Pastel, pequeño x3`;
      const json = rulesRecommendations(prompt);
      const parsed = parseRecommendations(json);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Tarta, grande');
      expect(parsed[1].type).toBe('promo');
      expect(parsed[1].title).toBe('Promocionar Pastel, pequeño');
    });

    it('provides ops when nothing else', () => {
      const prompt = `Restaurante: Test
Pedidos pendientes: 0
Stock bajo: ninguno
Top ventas: sin datos`;
      const json = rulesRecommendations(prompt);
      const parsed = parseRecommendations(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('ops');
    });

    it('caps recommendations at 5 entries', () => {
      const prompt = `Restaurante: Test
Pedidos pendientes: 0
Stock bajo: A (1), B (1), C (1), D (1), E (1)
Top ventas: F x3`;
      const json = rulesRecommendations(prompt);
      const parsed = parseRecommendations(json);
      expect(parsed.length).toBeLessThanOrEqual(5);
    });

    it('gives a restock with detail El stock actual es de 1e-7.', () => {
      const prompt = `Stock bajo: Harina (1e-7)\nTop ventas: sin datos`;
      const parsed = parseRecommendations(rulesRecommendations(prompt));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Harina');
      expect(parsed[0].detail).toBe('El stock actual es de 1e-7.');
    });

    it('gives a restock with detail El stock actual es de .5.', () => {
      const prompt = `Stock bajo: Harina (.5)\nTop ventas: sin datos`;
      const parsed = parseRecommendations(rulesRecommendations(prompt));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Harina');
      expect(parsed[0].detail).toBe('El stock actual es de .5.');
    });

    it('gives a restock with detail El stock actual es de -2. (replaces U+2212)', () => {
      const prompt = `Stock bajo: Harina (−2)\nTop ventas: sin datos`;
      const parsed = parseRecommendations(rulesRecommendations(prompt));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Harina');
      expect(parsed[0].detail).toBe('El stock actual es de -2.');
    });

    it('gives a restock for leading spaces and tab-indented lines', () => {
      const prompt1 = `  Stock bajo: Harina (2)\nTop ventas: sin datos`;
      const parsed1 = parseRecommendations(rulesRecommendations(prompt1));
      expect(parsed1).toHaveLength(1);
      expect(parsed1[0].type).toBe('restock');

      const prompt2 = `\tStock bajo: Harina (2)\nTop ventas: sin datos`;
      const parsed2 = parseRecommendations(rulesRecommendations(prompt2));
      expect(parsed2).toHaveLength(1);
      expect(parsed2[0].type).toBe('restock');
    });

    it('gives exactly 2 restock entries for Harina (abc), Leche (1)', () => {
      const prompt = `Stock bajo: Harina (abc), Leche (1)\nTop ventas: sin datos`;
      const parsed = parseRecommendations(rulesRecommendations(prompt));
      expect(parsed).toHaveLength(2);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Harina (abc)');
      expect(parsed[0].detail).toBe('Está en la lista de stock bajo.');
      expect(parsed[1].type).toBe('restock');
      expect(parsed[1].title).toBe('Reponer Leche');
      expect(parsed[1].detail).toBe('El stock actual es de 1.');
    });

    it('gives 1 restock entry for Harina (NaN)', () => {
      const prompt = `Stock bajo: Harina (NaN)\nTop ventas: sin datos`;
      const parsed = parseRecommendations(rulesRecommendations(prompt));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('restock');
      expect(parsed[0].title).toBe('Reponer Harina (NaN)');
      expect(parsed[0].detail).toBe('Está en la lista de stock bajo.');
    });

    it('gives a promo for Top ventas: Pan x1e3, Top ventas: Pan x3 (spaced) and Pan x.5', () => {
      const prompt1 = `Stock bajo: ninguno\nTop ventas: Pan x1e3`;
      const parsed1 = parseRecommendations(rulesRecommendations(prompt1));
      expect(parsed1[0].type).toBe('promo');
      expect(parsed1[0].title).toBe('Promocionar Pan');

      const prompt2 = `Stock bajo: ninguno\n  Top ventas: Pan x3`;
      const parsed2 = parseRecommendations(rulesRecommendations(prompt2));
      expect(parsed2[0].type).toBe('promo');
      expect(parsed2[0].title).toBe('Promocionar Pan');

      const prompt3 = `Stock bajo: ninguno\nTop ventas: Pan x.5`;
      const parsed3 = parseRecommendations(rulesRecommendations(prompt3));
      expect(parsed3[0].type).toBe('promo');
      expect(parsed3[0].title).toBe('Promocionar Pan');
    });

    it('keeps controls: handles commas and parentheses in names', () => {
      const prompt1 = `Stock bajo: Aceite (girasol) (2), Leche (1)\nTop ventas: sin datos`;
      const parsed1 = parseRecommendations(rulesRecommendations(prompt1));
      expect(parsed1[0].title).toBe('Reponer Aceite (girasol)');
      expect(parsed1[1].title).toBe('Reponer Leche');

      const prompt2 = `Stock bajo: Arroz, integral (2)\nTop ventas: sin datos`;
      const parsed2 = parseRecommendations(rulesRecommendations(prompt2));
      expect(parsed2[0].title).toBe('Reponer Arroz, integral');
    });

    it('still gives the single ops / Todo en orden entry for invalid entries AND no sales', () => {
      const prompt = `Stock bajo: ninguno\nTop ventas: sin datos`;
      const parsed = parseRecommendations(rulesRecommendations(prompt));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('ops');
      expect(parsed[0].title).toBe('Todo en orden');
    });
  });

  describe('localInfer', () => {
    it('uses engine when prompt-api tier is available', async () => {
      const session = {
        prompt: vi.fn().mockResolvedValue(JSON.stringify([{ type: 'promo', title: 'Test', detail: 'Test' }])),
        destroy: vi.fn(),
      };
      const languageModel = {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockResolvedValue(session),
      } as unknown as PromptApiLike;

      const prompt = 'test prompt\nDevuelve JSON: array de {type: restock|promo|menu|ops, title, detail} (máx 5, español).';
      const response = await localInfer(prompt, { languageModel });
      expect(languageModel.create).toHaveBeenCalledOnce();
      expect(languageModel.create).toHaveBeenCalledWith({ systemPrompt: 'Devuelve JSON: array de {type: restock|promo|menu|ops, title, detail} (máx 5, español).' });
      expect(session.prompt).toHaveBeenCalledWith(prompt);
      expect(session.destroy).toHaveBeenCalledOnce();
      const parsed = parseRecommendations(response);
      expect(parsed[0].title).toBe('Test');
    });

    it('falls back to rules if create rejects', async () => {
      const languageModel = {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockRejectedValue(new Error('no create')),
      } as unknown as PromptApiLike;
      const prompt = `Stock bajo: ninguno\nTop ventas: sin datos`;
      const response = await localInfer(prompt, { languageModel });
      const parsed = parseRecommendations(response);
      expect(parsed[0].type).toBe('ops');
    });

    it('falls back to rules if engine returns empty', async () => {
      const session = {
        prompt: vi.fn().mockResolvedValue(''),
        destroy: vi.fn(),
      };
      const languageModel = {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockResolvedValue(session),
      } as unknown as PromptApiLike;
      const prompt = `Stock bajo: ninguno\nTop ventas: sin datos`;
      const response = await localInfer(prompt, { languageModel });
      const parsed = parseRecommendations(response);
      expect(parsed[0].type).toBe('ops');
    });

    it('does not trigger download for downloadable tier and returns rules', async () => {
      const languageModel = {
        availability: vi.fn().mockResolvedValue('downloadable'),
        create: vi.fn(),
      } as unknown as PromptApiLike;
      const prompt = `Stock bajo: ninguno\nTop ventas: sin datos`;
      const response = await localInfer(prompt, { languageModel });
      expect(languageModel.create).not.toHaveBeenCalled();
      const parsed = parseRecommendations(response);
      expect(parsed[0].type).toBe('ops');
    });

    it('falls back to rules if engine prompt rejects', async () => {
      const session = {
        prompt: vi.fn().mockRejectedValue(new Error('fail')),
        destroy: vi.fn(),
      };
      const languageModel = {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockResolvedValue(session),
      } as unknown as PromptApiLike;
      const prompt = `Stock bajo: ninguno\nTop ventas: sin datos`;
      const response = await localInfer(prompt, { languageModel });
      const parsed = parseRecommendations(response);
      expect(parsed[0].type).toBe('ops');
      expect(session.destroy).toHaveBeenCalledOnce();
    });
  });
});
