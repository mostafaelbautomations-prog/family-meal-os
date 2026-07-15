// Group active recipes into Family favorites / Recently cooked / everything
// else, from feedback history. Shared by the swap sheets and the inline
// quick-switch dropdown so the two never drift.

import { subDays, format } from 'date-fns';
import type { MealFeedback, Recipe } from '../types';

export interface RecipeGroups {
  favorites: Recipe[];
  recent: Recipe[];
  rest: Recipe[];
}

const FAVORITE_MIN_AVG = 4; // avg enjoyment ≥ 4 (of 5) across all feedback
const RECENT_DAYS = 14;

export function groupActiveRecipes(
  recipes: Recipe[],
  feedback: MealFeedback[],
  opts: { excludeId?: string; recentDays?: number } = {}
): RecipeGroups {
  const pool = recipes.filter((r) => r.status === 'active' && r.id !== opts.excludeId);

  // Average enjoyment + latest cooked date per recipe.
  const stats = new Map<string, { sum: number; count: number; latest: string }>();
  for (const fb of feedback) {
    const s = stats.get(fb.recipeId) ?? { sum: 0, count: 0, latest: '' };
    for (const e of fb.entries) {
      s.sum += e.enjoyment;
      s.count += 1;
    }
    if (fb.date > s.latest) s.latest = fb.date;
    stats.set(fb.recipeId, s);
  }
  const avg = (id: string) => {
    const s = stats.get(id);
    return s && s.count > 0 ? s.sum / s.count : 0;
  };

  const favorites = pool.filter((r) => avg(r.id) >= FAVORITE_MIN_AVG).sort((a, b) => avg(b.id) - avg(a.id));
  const favoriteIds = new Set(favorites.map((r) => r.id));

  const cutoff = format(subDays(new Date(), opts.recentDays ?? RECENT_DAYS), 'yyyy-MM-dd');
  const recent = pool
    .filter((r) => !favoriteIds.has(r.id) && (stats.get(r.id)?.latest ?? '') >= cutoff)
    .sort((a, b) => (stats.get(b.id)?.latest ?? '').localeCompare(stats.get(a.id)?.latest ?? ''));

  const shownIds = new Set([...favoriteIds, ...recent.map((r) => r.id)]);
  const rest = pool.filter((r) => !shownIds.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));

  return { favorites, recent, rest };
}
