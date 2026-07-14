import { describe, expect, it } from 'vitest';
import type { Recipe, RecipeIngredient, WeekPlan } from '../types';
import { buildWeekGroceryList } from './grocery';

function ing(name: string, quantity: number, unit: string, isStaple = false): RecipeIngredient {
  return { name, quantity, unit, isStaple, optional: false };
}

function recipe(id: string, ingredients: RecipeIngredient[]): Recipe {
  return {
    id,
    name: id,
    description: '',
    cuisineTags: [],
    method: 'stove',
    servingsBase: 4,
    ingredients,
    prepSteps: [],
    nutrition: { caloriesPerServing: 500, proteinPerServing: 40, confidence: 'rough' },
    status: 'active',
    version: 1,
    changelog: [],
    createdAt: '',
    updatedAt: '',
  };
}

function plan(mealRecipeIds: string[], skippedIndex = -1): WeekPlan {
  return {
    id: 'plan',
    weekStartDate: '2026-07-12',
    status: 'active',
    generatedBy: 'manual',
    days: [
      {
        date: '2026-07-12',
        meals: mealRecipeIds.map((recipeId, i) => ({
          id: `m${i}`,
          recipeId,
          slot: 'main' as const,
          serveTime: '18:00',
          status: i === skippedIndex ? ('skipped' as const) : ('planned' as const),
        })),
      },
    ],
  };
}

describe('buildWeekGroceryList', () => {
  it('excludes staples', () => {
    const r = recipe('a', [ing('chicken breast', 600, 'g'), ing('salt', 1, 'tsp', true)]);
    const list = buildWeekGroceryList(plan(['a']), new Map([['a', r]]));
    expect(list.map((i) => i.name)).toEqual(['chicken breast']);
  });

  it('merges quantities when units match, across recipes and repeats', () => {
    const a = recipe('a', [ing('tilapia fillet', 600, 'g')]);
    const list = buildWeekGroceryList(plan(['a', 'a']), new Map([['a', a]]));
    expect(list).toEqual([{ name: 'tilapia fillet', quantity: '1200 g', linkedRecipeIds: ['a'] }]);
  });

  it('dedupes by normalized name (plural/case)', () => {
    const a = recipe('a', [ing('Tomatoes', 2, 'pieces')]);
    const b = recipe('b', [ing('tomato', 3, 'pieces')]);
    const list = buildWeekGroceryList(
      plan(['a', 'b']),
      new Map([
        ['a', a],
        ['b', b],
      ])
    );
    expect(list).toEqual([{ name: 'tomato', quantity: '5 pieces', linkedRecipeIds: ['a', 'b'] }]);
  });

  it('lists both units when they differ', () => {
    const a = recipe('a', [ing('chicken breast', 800, 'g')]);
    const b = recipe('b', [ing('chicken breast', 4, 'pieces')]);
    const list = buildWeekGroceryList(
      plan(['a', 'b']),
      new Map([
        ['a', a],
        ['b', b],
      ])
    );
    expect(list[0].quantity).toBe('800 g + 4 pieces');
  });

  it('skips skipped meals', () => {
    const a = recipe('a', [ing('avocado', 2, 'pieces')]);
    const list = buildWeekGroceryList(plan(['a'], 0), new Map([['a', a]]));
    expect(list).toEqual([]);
  });

  it('rounds merged fractional quantities sanely', () => {
    const a = recipe('a', [ing('white cabbage', 0.25, 'pieces')]);
    const list = buildWeekGroceryList(plan(['a', 'a']), new Map([['a', a]]));
    expect(list[0].quantity).toBe('0.5 pieces');
  });
});
