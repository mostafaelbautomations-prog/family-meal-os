// Recipes tab: every recipe the family has, with the self-improvement loop
// made visible — pending review suggestions to approve/dismiss right in the
// list, recent auto-applied changes, and "new reviews" nudges.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, Screen } from '../components/Screen';
import { SuggestionChipRow } from '../components/ReviewPanel';
import { peopleRepo, ratingsRepo, recipesRepo, suggestionsRepo } from '../db/repo';
import { newReviewCount } from '../ai/review';
import { formatMacrosCompact } from '../lib/nutrition';
import { IconChevronRight, IconPlus, IconSparkles } from '../components/Icons';
import type { Recipe } from '../types';

export function RecipesScreen() {
  const [query, setQuery] = useState('');
  const [showRetired, setShowRetired] = useState(false);

  const recipes = useLiveQuery(() => recipesRepo.all());
  const people = useLiveQuery(() => peopleRepo.all());
  const pending = useLiveQuery(() => suggestionsRepo.pending());
  const ratings = useLiveQuery(() => ratingsRepo.all());
  const freshCounts = useLiveQuery(async () => {
    const all = await recipesRepo.all();
    const entries = await Promise.all(all.map(async (r) => [r.id, await newReviewCount(r.id)] as const));
    return Object.fromEntries(entries) as Record<string, number>;
  });

  const q = query.trim().toLowerCase();
  const matches = (r: Recipe) =>
    !q || r.name.toLowerCase().includes(q) || r.cuisineTags.some((t) => t.toLowerCase().includes(q));

  const active = (recipes ?? [])
    .filter((r) => r.status === 'active' && matches(r))
    .sort((a, b) => a.name.localeCompare(b.name));
  const retired = (recipes ?? [])
    .filter((r) => r.status === 'retired' && matches(r))
    .sort((a, b) => a.name.localeCompare(b.name));

  const openCount = (pending ?? []).length;

  return (
    <Screen
      title="Recipes"
      subtitle={
        openCount > 0
          ? `${openCount} suggestion${openCount > 1 ? 's' : ''} from the family waiting for you`
          : 'Every dish, evolving with the family’s reviews'
      }
    >
      <div className="mb-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes…"
          className="min-h-12 w-0 flex-1 rounded-2xl border border-line bg-surface px-4"
        />
        <Link
          to="/chef"
          aria-label="Create a new recipe with the AI chef"
          title="Describe the meal you're envisioning — the AI chef writes the recipe"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-on-strong"
        >
          <IconPlus size={24} />
        </Link>
      </div>

      {recipes && active.length === 0 && retired.length === 0 && (
        <Card>
          <p className="text-ink-soft">{q ? 'Nothing matches that search.' : 'No recipes yet.'}</p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {active.map((recipe) => {
          const rowSuggestions = (pending ?? []).filter((s) => s.recipeId === recipe.id);
          const rowRatings = (ratings ?? []).filter((r) => r.recipeId === recipe.id);
          const avg = rowRatings.length
            ? (rowRatings.reduce((sum, r) => sum + r.rating, 0) / rowRatings.length).toFixed(1)
            : null;
          const fresh = freshCounts?.[recipe.id] ?? 0;
          return (
            <Card key={recipe.id} className="!p-3.5">
              <Link to={`/recipe/${recipe.id}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-display">{recipe.name}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {formatMacrosCompact(recipe.nutrition)} · {recipe.method} · v{recipe.version}
                    {avg && <span className="font-bold text-secondary"> · family {avg}/10</span>}
                  </p>
                </div>
                <IconChevronRight size={18} className="shrink-0 text-ink-soft" />
              </Link>

              {fresh > 0 && (
                <Link
                  to={`/recipe/${recipe.id}`}
                  className="mt-2 flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-mist text-xs font-bold text-secondary"
                >
                  <IconSparkles size={14} /> {fresh} new review{fresh > 1 ? 's' : ''} — see what to change
                </Link>
              )}

              {rowSuggestions.length > 0 && (
                <div className="mt-2 flex flex-col gap-2">
                  {rowSuggestions.map((s) => (
                    <SuggestionChipRow key={s.id} suggestion={s} people={people ?? []} />
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {retired.length > 0 && (
        <div className="mt-5">
          <button
            onClick={() => setShowRetired((v) => !v)}
            className="min-h-11 cursor-pointer text-sm font-bold text-ink-soft"
          >
            {showRetired ? 'Hide' : 'Show'} retired recipes ({retired.length})
          </button>
          {showRetired && (
            <div className="mt-2 flex flex-col gap-2">
              {retired.map((recipe) => (
                <Link
                  key={recipe.id}
                  to={`/recipe/${recipe.id}`}
                  className="rounded-2xl border border-line bg-surface p-3.5 opacity-70"
                >
                  <p className="font-display">{recipe.name}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    Retired{recipe.retiredReason ? `: ${recipe.retiredReason}` : ''}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}
