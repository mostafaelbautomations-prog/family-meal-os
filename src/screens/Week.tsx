// Week view: 7-day grid of the active plan. Tap a meal for its recipe, tap
// the status chip to cycle planned → cooked → skipped, swap any meal for
// another active recipe. "Generate next week" arrives with the engine (Phase 5).

import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Card, Screen } from '../components/Screen';
import { feedbackRepo, recipesRepo, weekPlansRepo } from '../db/repo';
import { generationUnlocked, loadDraft } from '../ai/engine';
import { formatDayLabel, isToday } from '../lib/dates';
import { groupActiveRecipes } from '../lib/recipeGroups';
import { MealQuickSwitch } from '../components/MealQuickSwitch';
import type { MealStatus } from '../types';
import { IconSparkles } from '../components/Icons';

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
  const data = useLiveQuery(async () => {
    const plan = await weekPlansRepo.activePlan();
    if (!plan) return undefined;
    const [all, feedback] = await Promise.all([recipesRepo.all(), feedbackRepo.all()]);
    return {
      plan,
      recipes: new Map(all.map((r) => [r.id, r])),
      groups: groupActiveRecipes(all, feedback),
      unlocked: await generationUnlocked(),
      hasDraft: loadDraft() !== null,
    };
  });

  // Weekly nutrition, rough framing (spec §7): average per person per day.
  const weeklyAvg = (() => {
    if (!data) return undefined;
    let kcal = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    for (const day of data.plan.days) {
      for (const meal of day.meals) {
        const r = data.recipes.get(meal.recipeId);
        if (r && meal.status !== 'skipped') {
          kcal += r.nutrition.caloriesPerServing;
          protein += r.nutrition.proteinPerServing;
          carbs += r.nutrition.carbsPerServing ?? 0;
          fat += r.nutrition.fatPerServing ?? 0;
        }
      }
    }
    return {
      kcal: Math.round(kcal / 7 / 25) * 25,
      protein: Math.round(protein / 7 / 5) * 5,
      carbs: Math.round(carbs / 7 / 5) * 5,
      fat: Math.round(fat / 7 / 5) * 5,
    };
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
              ? 'bg-accent text-on-strong'
              : data.unlocked
                ? 'bg-primary text-on-strong'
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
          let dayCarbs = 0;
          let dayFat = 0;
          for (const meal of day.meals) {
            const r = data.recipes.get(meal.recipeId);
            if (r && meal.status !== 'skipped') {
              dayKcal += r.nutrition.caloriesPerServing;
              dayProtein += r.nutrition.proteinPerServing;
              dayCarbs += r.nutrition.carbsPerServing ?? 0;
              dayFat += r.nutrition.fatPerServing ?? 0;
            }
          }
          return (
            <Card key={day.date} className={isToday(day.date) ? 'border-primary/40 bg-primary/[0.08]' : ''}>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-xs font-bold tracking-wide text-secondary uppercase">
                  {formatDayLabel(day.date)}
                  {isToday(day.date) && ' · Today'}
                </p>
                <p className="text-xs text-ink-soft tabular-nums">
                  ≈ {dayKcal} kcal · P{dayProtein} C{dayCarbs} F{dayFat}
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {day.meals.map((meal) => {
                  const recipe = data.recipes.get(meal.recipeId);
                  return (
                    <li key={meal.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/recipe/${meal.recipeId}`}
                          className="min-h-11 flex-1 self-center py-2 font-semibold"
                        >
                          {recipe?.name ?? 'Unknown recipe'}
                        </Link>
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
                      </div>
                      {recipe && meal.status === 'planned' && (
                        <MealQuickSwitch
                          planId={data.plan.id}
                          mealId={meal.id}
                          currentRecipe={recipe}
                          groups={data.groups}
                          className="w-full"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}

        {weeklyAvg && (
          <p className="text-center text-xs text-ink-soft">
            Weekly average ≈ {weeklyAvg.kcal} kcal · {weeklyAvg.protein}g protein · {weeklyAvg.carbs}g
            carbs · {weeklyAvg.fat}g fat per person per day. Estimates are rough.
          </p>
        )}
      </div>
    </Screen>
  );
}
