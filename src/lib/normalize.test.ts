import { describe, expect, it } from 'vitest';
import { normalizeIngredientName } from './normalize';

describe('normalizeIngredientName', () => {
  it('lowercases and trims', () => {
    expect(normalizeIngredientName('  Chicken Breast ')).toBe('chicken breast');
  });

  it('collapses inner whitespace', () => {
    expect(normalizeIngredientName('olive   oil')).toBe('olive oil');
  });

  it('singularizes plain plurals', () => {
    expect(normalizeIngredientName('onions')).toBe('onion');
    expect(normalizeIngredientName('sweet potatoes')).toBe('sweet potato');
    expect(normalizeIngredientName('tomatoes')).toBe('tomato');
  });

  it('singularizes -ies plurals', () => {
    expect(normalizeIngredientName('berries')).toBe('berry');
  });

  it('does not mangle -ss words', () => {
    expect(normalizeIngredientName('watercress')).toBe('watercress');
    expect(normalizeIngredientName('hummus')).toBe('hummus');
    expect(normalizeIngredientName('couscous')).toBe('couscous');
  });

  it('only singularizes the last word', () => {
    expect(normalizeIngredientName('Foul Cans')).toBe('foul can');
  });

  it('leaves short words alone', () => {
    expect(normalizeIngredientName('gas')).toBe('gas');
  });
});
