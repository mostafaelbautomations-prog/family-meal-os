// Week view: 7-day grid of the active plan. Tap a meal for its recipe, tap
// the status chip to cycle planned → cooked → skipped, swap any meal for
// another active recipe. "Generate next week" arrives with the engine (Phase 5).

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Card, Screen } from '../components/Screen';
import { recipesRepo, weekPlansRepo } from '../db/repo';
import { generationUnlocked, loadDraft } from '../ai/engine';
import { formatDayLabel, isToday } from '../lib/dates';
import type { MealStatus, Recipe } from '../types';
import { IconSparkles, IconSwap, IconX } from '../components/Icons';

const STATUS_STYLE: Record<MealStatus, string> = {
  planned: 'bg-mist text-ink-soft',
  cooked: 'bg-accent/10 text-accent',
  skipped: 'bg-line text-ink-soft line-through',
};

const NEXT_STATUS: Record<MealStatus, MealStatus> = {
  planned: 'cooked',
  cooked: 'skipped',
  skipped: 'planned',
};

export function WeekScreen() {
  const [swapTarget, setSwapTarget] = useState<{ planId: string; mealId: string; currentName: string } | null>(
    null
  );

  const data = useLiveQuery(async () => {
    const plan = await weekPlansRepo.activePlan();
    if (!plan) return undefined;
    const all = await recipesRepo.all();
    return {
      plan,
      recipes: new Map(all.map((r) => [r.id, r])),
      activeRecipes: all
        .filter((r) => r.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name)),
      unlocked: await generationUnlocked(),
      hasDraft: loadDraft() !== null,
    };
  });

  // Weekly nutrition, rough framing (spec §7): average per person per day.
  const weeklyAvg = (() => {
    if (!data) return undefined;
    let kcal = 0;
    let protein = 0;
    for (const day of data.plan.days) {
      for (const meal of day.meals) {
        const r = data.recipes.get(meal.recipeId);
        if (r && meal.status !== 'skipped') {
          kcal += r.nutrition.caloriesPerServing;
          protein += r.nutrition.proteinPerServing;
        }
      }
    }
    return { kcal: Math.round(kcal / 7 / 25) * 25, protein: Math.round(protein / 7 / 5) * 5 };
  })();

  return (
    <Screen title="This Week" subtitle={data ? `Week of ${formatDayLabel(data.plan.weekStartDate)}` : undefined}>
      {!data && (
        <Card>
          <p className="text-ink-soft">No active week plan.</p>
        </Card>
      )}

      {data && (
        <Link
          to="/generate"
          className={`mb-3 flex min-h-13 items-center justify-center gap-2 rounded-2xl py-3 font-display ${
            data.hasDraft
              ? 'bg-accent text-white'
              : data.unlocked
                ? 'bg-primary text-white'
                : 'bg-mist text-ink-soft'
          }`}
        >
          <IconSparkles size={20} />
          {data.hasDraft ? "Review next week's draft" : 'Generate next week'}
        </Link>
      )}

      {data?.plan.aiRationale && (
        <Card className="mb-3">
          <p className="text-xs font-bold tracking-wide text-secondary uppercase">Why this week looks like this</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-ink-soft">{data.plan.aiRationale}</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {data?.plan.days.map((day) => {
          let dayKcal = 0;
          let dayProtein = 0;
          for (const meal of day.meals) {
            const r = data.recipes.get(meal.recipeId);
            if (r && meal.status !== 'skipped') {
              dayKcal += r.nutrition.caloriesPerServing;
              dayProtein += r.nutrition.proteinPerServing;
            }
          }
          return (
            <Card key={day.date} className={isToday(day.date) ? 'border-primary/40 bg-primary/[0.03]' : ''}>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-xs font-bold tracking-wide text-secondary uppercase">
                  {formatDayLabel(day.date)}
                  {isToday(day.date) && ' · Today'}
                </p>
                <p className="text-xs text-ink-soft">
                  ≈ {dayKcal} kcal · {dayProtein}g
                </p>
              </div>
              <ul className="flex flex-col gap-1">
                {day.meals.map((meal) => {
                  const recipe = data.recipes.get(meal.recipeId);
                  return (
                    <li key={meal.id} className="flex items-center gap-1.5">
                      <Link
                        to={`/recipe/${meal.recipeId}`}
                        className="min-h-11 flex-1 self-center py-2 font-semibold"
                      >
                        {recipe?.name ?? 'Unknown recipe'}
                      </Link>
                      <button
                        aria-label={`Swap ${recipe?.name ?? 'meal'}`}
                        onClick={() =>
                          setSwapTarget({
                            planId: data.plan.id,
                            mealId: meal.id,
                            currentName: recipe?.name ?? '',
                          })
                        }
                        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-soft"
                      >
                        <IconSwap size={18} />
                      </button>
                      <button
                        onClick={() =>
                          void weekPlansRepo.updateMeal(data.plan.id, meal.id, {
                            status: NEXT_STATUS[meal.status],
                          })
                        }
                        className={`min-h-11 w-20 shrink-0 cursor-pointer rounded-full text-xs font-bold ${STATUS_STYLE[meal.status]}`}
                        aria-label={`Status: ${meal.status}. Tap to change.`}
                      >
                        {meal.status}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}

        {weeklyAvg && (
          <p className="text-center text-xs text-ink-soft">
            Weekly average ≈ {weeklyAvg.kcal} kcal · {weeklyAvg.protein}g protein per person per day.
            Estimates are rough.
          </p>
        )}
      </div>

      {swapTarget && data && (
        <SwapSheet
          target={swapTarget}
          recipes={data.activeRecipes}
          onClose={() => setSwapTarget(null)}
        />
      )}
    </Screen>
  );
}

function SwapSheet({
  target,
  recipes,
  onClose,
}: {
  target: { planId: string; mealId: string; currentName: string };
  recipes: Recipe[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[75dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Swap meal"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">Swap "{target.currentName}" for…</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-mist text-ink-soft"
          >
            <IconX size={20} />
          </button>
        </div>
        <ul className="flex flex-col divide-y divide-line">
          {recipes.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => {
                  void weekPlansRepo.updateMeal(target.planId, target.mealId, { recipeId: r.id });
                  onClose();
                }}
                className="min-h-12 w-full cursor-pointer py-2 text-left"
              >
                <span className="block font-semibold">{r.name}</span>
                <span className="block text-xs text-ink-soft">
                  ≈ {r.nutrition.caloriesPerServing} kcal · {r.nutrition.proteinPerServing}g protein · {r.method}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
