// Inline instant meal switcher: a native dropdown that swaps a planned meal
// the moment you pick a new recipe — no modal, one tap. Options are grouped
// Family favorites / Recently cooked / All. Used on Today and Week.
//
// Native <select> is deliberate: it opens the OS wheel/menu on phones (great
// with greasy kitchen hands) and applies instantly on change.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { feedbackRepo, recipesRepo, weekPlansRepo } from '../db/repo';
import { groupActiveRecipes, type RecipeGroups } from '../lib/recipeGroups';
import type { Recipe } from '../types';
import { IconSwap } from './Icons';

export function MealQuickSwitch({
  planId,
  mealId,
  currentRecipe,
  groups,
  className = '',
}: {
  planId: string;
  mealId: string;
  currentRecipe: Recipe;
  /** Precomputed groups (Week passes one shared set); self-fetched if omitted. */
  groups?: RecipeGroups;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);

  // Self-fetch only when the parent hasn't already computed the groups.
  const fetched = useLiveQuery(
    async () => {
      if (groups) return undefined;
      const [recipes, feedback] = await Promise.all([recipesRepo.all(), feedbackRepo.all()]);
      return groupActiveRecipes(recipes, feedback, { excludeId: currentRecipe.id });
    },
    [groups, currentRecipe.id]
  );

  const resolved = groups ?? fetched;

  async function change(recipeId: string) {
    if (!recipeId || recipeId === currentRecipe.id) return;
    setSaving(true);
    try {
      await weekPlansRepo.updateMeal(planId, mealId, { recipeId });
    } finally {
      setSaving(false);
    }
  }

  const option = (r: Recipe) => (
    <option key={r.id} value={r.id}>
      {r.name}
    </option>
  );
  // Defensive: never list the current recipe twice (it's the top option).
  const notCurrent = (r: Recipe) => r.id !== currentRecipe.id;

  return (
    <div className={`relative inline-flex min-w-0 items-center ${className}`}>
      <IconSwap size={14} className="pointer-events-none absolute left-2.5 text-secondary" />
      <select
        value={currentRecipe.id}
        disabled={saving || !resolved}
        onChange={(e) => void change(e.target.value)}
        aria-label={`Switch ${currentRecipe.name} for another recipe`}
        className="min-h-11 w-full min-w-0 cursor-pointer truncate rounded-lg border border-line bg-surface py-2 pr-8 pl-8 text-sm font-semibold text-secondary disabled:opacity-60"
      >
        <option value={currentRecipe.id}>{currentRecipe.name} (now)</option>
        {resolved?.favorites.filter(notCurrent).length ? (
          <optgroup label="Family favorites">{resolved.favorites.filter(notCurrent).map(option)}</optgroup>
        ) : null}
        {resolved?.recent.filter(notCurrent).length ? (
          <optgroup label="Recently cooked">{resolved.recent.filter(notCurrent).map(option)}</optgroup>
        ) : null}
        {resolved?.rest.filter(notCurrent).length ? (
          <optgroup label="All recipes">{resolved.rest.filter(notCurrent).map(option)}</optgroup>
        ) : null}
      </select>
    </div>
  );
}
