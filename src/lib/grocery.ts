// Grocery list generation from a week plan (spec §4.4). Pure — unit tested.
// Union of all non-staple ingredients across the week's recipes, deduplicated
// by normalized name; quantities merged when units match, listed side by side
// when they don't ("chicken breast — 800 g + 4 pieces").

import type { Recipe, WeekPlan } from '../types';
import { normalizeIngredientName } from './normalize';

export interface MergedGroceryItem {
  name: string; // normalized
  quantity?: string; // "1.2 kg" or "800 g + 4 pieces"
  linkedRecipeIds: string[];
}

export function buildWeekGroceryList(plan: WeekPlan, recipes: Map<string, Recipe>): MergedGroceryItem[] {
  const acc = new Map<string, { units: Map<string, number>; recipeIds: Set<string> }>();

  for (const day of plan.days) {
    for (const meal of day.meals) {
      if (meal.status === 'skipped') continue;
      const recipe = recipes.get(meal.recipeId);
      if (!recipe) continue;
      // Per-meal servings override (e.g. 3 when someone's out) scales quantities.
      const factor = (meal.servings ?? recipe.servingsBase) / recipe.servingsBase;
      for (const ing of recipe.ingredients) {
        if (ing.isStaple) continue; // staples come from the pantry
        const name = normalizeIngredientName(ing.name);
        const entry = acc.get(name) ?? { units: new Map<string, number>(), recipeIds: new Set<string>() };
        const unit = ing.unit.trim().toLowerCase();
        entry.units.set(unit, (entry.units.get(unit) ?? 0) + ing.quantity * factor);
        entry.recipeIds.add(recipe.id);
        acc.set(name, entry);
      }
    }
  }

  return [...acc.entries()]
    .map(([name, { units, recipeIds }]) => ({
      name,
      quantity: formatQuantities(units),
      linkedRecipeIds: [...recipeIds],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatQuantities(units: Map<string, number>): string {
  return [...units.entries()].map(([unit, qty]) => `${roundQty(qty)} ${unit}`).join(' + ');
}

function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}
