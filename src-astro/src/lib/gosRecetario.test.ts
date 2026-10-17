import { describe, it, expect } from 'vitest';
import {
  parseGosVaultExport,
  normalizeIngredientName,
  matchIngredient,
  gosRecipeToFizeLines,
  parseServings,
  parseMinutes,
  encodeGosLink,
  decodeGosLink,
  GOS_LINK_PARAM,
  GOS_LINK_MAX_CHARS,
  GOS_VAULT_FORMAT,
  GOS_VAULT_VERSION,
} from './gosRecetario';

describe('gosRecetario', () => {
  describe('parseGosVaultExport', () => {
    it('parses bare record correctly', () => {
      const input = {
        format: GOS_VAULT_FORMAT,
        version: GOS_VAULT_VERSION,
        recipes: [
          {
            title: 'Pasta',
            main_ingredients: ['Tomato', 'Pasta'],
            instructions: ['Boil water', 'Cook'],
            servings: '2',
            prep_time: '10 min',
            cook_time: '15 min',
            id: 'drop_me',
            created_at: '2023',
            notes: 'secret'
          }
        ]
      };

      const res = parseGosVaultExport(input);
      expect(res.ok).toBe(true);
      expect(res.recipes).toHaveLength(1);
      expect(res.recipes[0].title).toBe('Pasta');
      expect((res.recipes[0] as any).notes).toBeUndefined();
    });

    it('parses {recipe:...} wrapper correctly', () => {
      const input = {
        format: GOS_VAULT_FORMAT,
        version: GOS_VAULT_VERSION,
        recipes: [
          {
            recipe: {
              title: 'Pizza',
              main_ingredients: ['Dough'],
              instructions: ['Bake'],
              servings: '4',
              id: '123'
            }
          }
        ]
      };

      const res = parseGosVaultExport(input);
      expect(res.ok).toBe(true);
      expect(res.recipes[0].title).toBe('Pizza');
      expect((res.recipes[0] as any).id).toBeUndefined();
    });

    it('rejects wrong format', () => {
      const res = parseGosVaultExport({ format: 'other', version: 1, recipes: [] });
      expect(res.ok).toBe(false);
    });

    it('rejects wrong version', () => {
      const res = parseGosVaultExport({ format: GOS_VAULT_FORMAT, version: 2, recipes: [] });
      expect(res.ok).toBe(false);
    });

    it('rejects missing recipes array', () => {
      const res = parseGosVaultExport({ format: GOS_VAULT_FORMAT, version: 1 });
      expect(res.ok).toBe(false);
    });

    it('handles invalid json string', () => {
      const res = parseGosVaultExport('bad json');
      expect(res.ok).toBe(false);
    });
  });

  describe('normalizeIngredientName & matchIngredient', () => {
    it('normalizes accents and whitespace', () => {
      expect(normalizeIngredientName('  Cebolla   Cabezóna ')).toBe('cebolla cabezona');
    });

    it('matches exact ignoring case and accents', () => {
      const inventory = [
        { id: '1', name: 'Tomate Chonto', unit: 'kg', unitCost: 1000 },
        { id: '2', name: 'Cebolla', unit: 'kg', unitCost: 800 }
      ];

      const match = matchIngredient(' tomáte chonto ', inventory);
      expect(match?.id).toBe('1');

      const none = matchIngredient('Pimenton', inventory);
      expect(none).toBeNull();
    });
  });

  describe('gosRecipeToFizeLines', () => {
    it('builds lines and lists unmatched', () => {
      const recipe = {
        title: 'Salsa',
        main_ingredients: ['Tomate', 'Sal', 'Ajo'],
        instructions: []
      };

      const inventory = [
        { id: 'inv_1', name: 'Tomate', unit: 'kg', unitCost: 1000 },
        { id: 'inv_2', name: 'Ajo', unit: 'g', unitCost: 50 }
      ];

      const res = gosRecipeToFizeLines(recipe, inventory, 2);
      expect(res.lines).toHaveLength(2);
      expect(res.lines[0].inventoryItemId).toBe('inv_1');
      expect(res.lines[0].qty).toBe(2);
      expect(res.lines[0].unit).toBe('kg');
      expect(res.unmatched).toEqual(['Sal']);
    });
  });

  describe('count parsers', () => {
    it('parses servings', () => {
      expect(parseServings('4 porciones')).toBe(4);
      expect(parseServings(3)).toBe(3);
      expect(parseServings('ninguno')).toBe(1); // default
    });

    it('parses minutes', () => {
      expect(parseMinutes('1 h 20 min')).toBe(1); // just takes first match
      expect(parseMinutes('20')).toBe(20);
      expect(parseMinutes('rapido')).toBe(0); // default
    });
  });

  describe('link codec', () => {
    it('encodes and decodes round trip', () => {
      const recipes = [{ title: 'Salad', main_ingredients: ['Lettuce'], instructions: ['Mix'] }];
      const encoded = encodeGosLink(recipes);
      const decoded = decodeGosLink(`?${GOS_LINK_PARAM}=${encoded}`);

      expect(decoded.ok).toBe(true);
      expect(decoded.recipes).toHaveLength(1);
      expect(decoded.recipes[0].title).toBe('Salad');
    });

    it('rejects missing param', () => {
      const decoded = decodeGosLink('?other=123');
      expect(decoded.ok).toBe(false);
    });

    it('rejects malformed base64url', () => {
      const decoded = decodeGosLink(`?${GOS_LINK_PARAM}=!@#$`);
      expect(decoded.ok).toBe(false);
    });

    it('rejects payload too long', () => {
      const longPayload = 'A'.repeat(GOS_LINK_MAX_CHARS + 1);
      const decoded = decodeGosLink(`?${GOS_LINK_PARAM}=${longPayload}`);
      expect(decoded.ok).toBe(false);
      expect(decoded.error).toMatch(/too|long|MAX_CHARS|demasiado/i);
    });
  });
});
