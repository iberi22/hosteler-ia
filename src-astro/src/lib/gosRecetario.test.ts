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

    it('rejects fuzzy matches (e.g. Tomate vs Tomate picado)', () => {
      const inventory = [
        { id: '1', name: 'Tomate picado', unit: 'kg', unitCost: 1000 }
      ];
      const match = matchIngredient('Tomate', inventory);
      expect(match).toBeNull();
    });

    it('rejects reverse fuzzy matches (e.g. Tomate picado vs Tomate)', () => {
      const inventory = [
        { id: '1', name: 'Tomate', unit: 'kg', unitCost: 1000 }
      ];
      const match = matchIngredient('Tomate picado', inventory);
      expect(match).toBeNull();
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

    it('handles missing unitCost or NaN by falling back to 0', () => {
      const recipe = {
        title: 'Sopa',
        main_ingredients: ['Agua', 'Hueso'],
        instructions: []
      };

      const inventory = [
        { id: 'inv_1', name: 'Agua', unit: 'L', unitCost: NaN },
        { id: 'inv_2', name: 'Hueso', unit: 'kg', unitCost: undefined as any } // Missing unitCost
      ];

      const res = gosRecipeToFizeLines(recipe, inventory);
      expect(res.lines).toHaveLength(2);
      expect(res.lines[0].unitCost).toBe(0);
      expect(res.lines[1].unitCost).toBe(0);
    });
  });

  describe('count parsers', () => {
    it('parses servings', () => {
      expect(parseServings('4 porciones')).toBe(4);
      expect(parseServings(3)).toBe(3);
      expect(parseServings('ninguno')).toBe(1); // default
    });

    it('parses minutes', () => {
      expect(parseMinutes('1 h 30 min')).toBe(90);
      expect(parseMinutes('20')).toBe(20);
      expect(parseMinutes('1 h')).toBe(60);
      expect(parseMinutes('3000')).toBe(1440); // Clamped
      expect(parseMinutes('48 horas')).toBe(1440); // Clamped via total calculation
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

    it('the encoded link must not contain id, instance_id, created_at, or notes', () => {
      const recipes = [{
        title: 'Secret Pizza',
        main_ingredients: ['Dough'],
        instructions: ['Bake'],
        id: 'some_id',
        instance_id: 'tenant_id',
        created_at: '2021-01-01',
        notes: 'Top secret recipe!'
      }];

      const encoded = encodeGosLink(recipes);
      let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const rawJsonStr = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
      const payload = JSON.parse(rawJsonStr);

      expect(payload.recipes[0].id).toBeUndefined();
      expect(payload.recipes[0].instance_id).toBeUndefined();
      expect(payload.recipes[0].created_at).toBeUndefined();
      expect(payload.recipes[0].notes).toBeUndefined();
    });

    it('base64url round trip with a payload that produces + and / in standard base64', () => {
      // Create characters that will definitively cause + and / in base64 output
      // For instance, the sequence of bytes 0xFB, 0xEF or typical strings that align appropriately.
      // Easiest is to provide an array of characters that force base64 to output '+' and '/'.
      // e.g. "subjects???" -> "c3ViamVjdHM/Pz8="
      const recipes = [{ title: 'subjects???', main_ingredients: ['>_>'], instructions: ['Mix'] }];
      const encoded = encodeGosLink(recipes);

      // Assure the encoded URL doesn't have '+' or '/'
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');

      const decoded = decodeGosLink(`?${GOS_LINK_PARAM}=${encoded}`);
      expect(decoded.ok).toBe(true);
      expect(decoded.recipes[0].title).toBe('subjects???');
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
