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

      const response = await localInfer('test prompt', { languageModel });
      expect(languageModel.create).toHaveBeenCalledOnce();
      expect(session.prompt).toHaveBeenCalledWith('test prompt');
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
