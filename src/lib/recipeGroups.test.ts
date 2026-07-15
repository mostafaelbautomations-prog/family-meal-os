import { describe, expect, it } from 'vitest';
import { groupActiveRecipes } from './recipeGroups';
import type { MealFeedback, Recipe } from '../types';
import { format, subDays } from 'date-fns';

function recipe(id: string, name: string, status: Recipe['status'] = 'active'): Recipe {
  return {
    id,
    name,
    description: '',
    cuisineTags: [],
    method: 'stove',
    servingsBase: 4,
    ingredients: [],
    prepSteps: [],
    nutrition: { caloriesPerServing: 500, proteinPerServing: 40, confidence: 'rough' },
    status,
    version: 1,
    changelog: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function fb(recipeId: string, date: string, enjoyment: 1 | 2 | 3 | 4 | 5): MealFeedback {
  return {
    id: `fb-${recipeId}-${date}`,
    plannedMealId: `pm-${recipeId}-${date}`,
    recipeId,
    date,
    entries: [{ personId: 'dad', ateAmount: 'all', enjoyment }],
    cookNotes: '',
    overallNote: '',
  };
}

const iso = (daysAgo: number) => format(subDays(new Date(), daysAgo), 'yyyy-MM-dd');

describe('groupActiveRecipes', () => {
  const recipes = [
    recipe('loved', 'Loved Dish'),
    recipe('recent', 'Recent Dish'),
    recipe('old', 'Old Untouched'),
    recipe('gone', 'Retired Dish', 'retired'),
  ];

  it('puts high-enjoyment recipes in favorites, sorted by average', () => {
    const feedback = [fb('loved', iso(3), 5), fb('recent', iso(2), 3), fb('old', iso(200), 2)];
    const groups = groupActiveRecipes(recipes, feedback);
    expect(groups.favorites.map((r) => r.id)).toEqual(['loved']);
  });

  it('classifies recently-cooked non-favorites as recent', () => {
    const feedback = [fb('recent', iso(2), 3)];
    const groups = groupActiveRecipes(recipes, feedback);
    expect(groups.recent.map((r) => r.id)).toContain('recent');
    expect(groups.favorites.map((r) => r.id)).not.toContain('recent');
  });

  it('drops feedback older than the recency window from recent', () => {
    const feedback = [fb('recent', iso(30), 3)];
    const groups = groupActiveRecipes(recipes, feedback);
    expect(groups.recent.map((r) => r.id)).not.toContain('recent');
    expect(groups.rest.map((r) => r.id)).toContain('recent');
  });

  it('never includes retired recipes', () => {
    const groups = groupActiveRecipes(recipes, []);
    const allIds = [...groups.favorites, ...groups.recent, ...groups.rest].map((r) => r.id);
    expect(allIds).not.toContain('gone');
  });

  it('excludes a given recipe id from every group', () => {
    const feedback = [fb('loved', iso(3), 5)];
    const groups = groupActiveRecipes(recipes, feedback, { excludeId: 'loved' });
    const allIds = [...groups.favorites, ...groups.recent, ...groups.rest].map((r) => r.id);
    expect(allIds).not.toContain('loved');
  });

  it('sorts the rest alphabetically', () => {
    const groups = groupActiveRecipes(recipes, []);
    const names = groups.rest.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
