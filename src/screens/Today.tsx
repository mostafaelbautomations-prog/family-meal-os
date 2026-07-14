// Today: the reminder system. Advance-prep checklist on top (red when past
// due), then per-meal cards with editable serve time, cook timeline, the
// ingredient checklist with ran-out quick action, and the log-feedback card
// once serve time has passed.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Screen } from '../components/Screen';
import { markIngredientRanOut, recipesRepo, weekPlansRepo, feedbackRepo } from '../db/repo';
import { formatClock, formatDayLabel, todayISO } from '../lib/dates';
import { advanceSteps, cookSteps, mealTimeline, servePassed } from '../lib/timeline';
import { getChecks, toggleCheck } from '../lib/stepChecks';
import { backupNudgeDue, snoozeNudge } from '../lib/backupNudge';
import type { PlannedMeal, Recipe } from '../types';
import { IconAlert, IconCheck, IconChevronRight, IconDownload, IconFlame, IconX } from '../components/Icons';

const SLOT_LABEL: Record<PlannedMeal['slot'], string> = {
  main: 'Main meal',
  snack: 'Snack',
  meal1: 'First meal',
  meal2: 'Second meal',
};

interface TodayMeal {
  planId: string;
  meal: PlannedMeal;
  recipe: Recipe;
  logged: boolean;
}

/** Ticks every 30s so past-due states update while the app is open. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function TodayScreen() {
  const now = useNow();
  const date = todayISO();

  const meals = useLiveQuery(async (): Promise<TodayMeal[]> => {
    const plan = await weekPlansRepo.activePlan();
    const day = plan?.days.find((d) => d.date === date);
    if (!plan || !day) return [];
    const out: TodayMeal[] = [];
    for (const meal of day.meals) {
      const recipe = await recipesRepo.byId(meal.recipeId);
      if (!recipe) continue;
      const logged = !!(await feedbackRepo.byPlannedMeal(meal.id));
      out.push({ planId: plan.id, meal, recipe, logged });
    }
    return out;
  }, [date]);

  return (
    <Screen title="Today" subtitle={formatDayLabel(date)}>
      <BackupNudge />
      {meals && meals.length === 0 && (
        <Card>
          <p className="text-ink-soft">No meals planned for today. Check the Week tab.</p>
        </Card>
      )}

      {meals && meals.length > 0 && (
        <div className="flex flex-col gap-4">
          <AdvancePrepSection meals={meals} date={date} now={now} />
          {meals.map((tm) => (
            <MealCard key={tm.meal.id} tm={tm} date={date} now={now} />
          ))}
          <p className="text-center text-xs text-ink-soft">Nutrition estimates are rough.</p>
        </div>
      )}
    </Screen>
  );
}

// --- Backup nudge --------------------------------------------------------------

function BackupNudge() {
  const [visible, setVisible] = useState(() => backupNudgeDue());
  if (!visible) return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-secondary/30 bg-secondary/10 p-3 text-sm">
      <IconDownload size={18} className="shrink-0 text-secondary" />
      <p className="flex-1">
        Your data lives only in this browser.{' '}
        <Link to="/settings" className="font-bold text-secondary underline">
          Export a backup
        </Link>{' '}
        to keep it safe.
      </p>
      <button
        onClick={() => {
          snoozeNudge();
          setVisible(false);
        }}
        aria-label="Dismiss backup reminder"
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-ink-soft"
      >
        <IconX size={16} />
      </button>
    </div>
  );
}

// --- Advance prep (defrost / marinate / soak) --------------------------------

function AdvancePrepSection({ meals, date, now }: { meals: TodayMeal[]; date: string; now: Date }) {
  const [, setBump] = useState(0); // re-render after toggling a localStorage check

  const items = useMemo(() => {
    return meals.flatMap((tm) => {
      const tl = mealTimeline(tm.recipe.prepSteps, date, tm.meal.serveTime, now);
      const checks = getChecks(tm.meal.id);
      return advanceSteps(tl).map((step) => ({
        mealId: tm.meal.id,
        recipeName: tm.recipe.name,
        step,
        checked: checks.has(step.id),
      }));
    });
  }, [meals, date, now]);

  if (items.length === 0) return null;

  return (
    <Card>
      <h2 className="mb-2 font-display text-lg">Ahead of time</h2>
      <ul className="flex flex-col divide-y divide-line">
        {items.map(({ mealId, recipeName, step, checked }) => {
          const overdue = step.pastDue && !checked;
          return (
            <li key={`${mealId}-${step.id}`}>
              <button
                onClick={() => {
                  toggleCheck(mealId, step.id);
                  setBump((n) => n + 1);
                }}
                className={`flex min-h-12 w-full cursor-pointer items-center gap-3 py-2 text-left ${
                  overdue ? 'text-danger' : checked ? 'text-ink-soft' : ''
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                    checked
                      ? 'border-accent bg-accent text-white'
                      : overdue
                        ? 'border-danger'
                        : 'border-line'
                  }`}
                >
                  {checked && <IconCheck size={16} strokeWidth={3} />}
                </span>
                <span className="flex-1">
                  <span className={`block font-semibold ${checked ? 'line-through' : ''}`}>
                    {overdue && <IconAlert size={16} className="mr-1 inline -translate-y-px" />}
                    {step.instruction}
                  </span>
                  <span className="block text-xs opacity-80">
                    {recipeName} · {overdue ? `was due ${formatClock(step.due)}` : formatClock(step.due)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- One meal ------------------------------------------------------------------

function MealCard({ tm, date, now }: { tm: TodayMeal; date: string; now: Date }) {
  const { meal, recipe, planId } = tm;
  const navigate = useNavigate();
  const [, setBump] = useState(0);
  const [ranOut, setRanOut] = useState<Set<string>>(new Set());

  const timeline = mealTimeline(recipe.prepSteps, date, meal.serveTime, now);
  const cooking = cookSteps(timeline);
  const passed = servePassed(date, meal.serveTime, now);
  const checks = getChecks(meal.id);

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wide text-secondary uppercase">{SLOT_LABEL[meal.slot]}</p>
          <Link to={`/recipe/${recipe.id}`} className="font-display text-xl leading-tight">
            {recipe.name}
          </Link>
          <p className="mt-0.5 text-sm text-ink-soft">
            ≈ {recipe.nutrition.caloriesPerServing} kcal · ≈ {recipe.nutrition.proteinPerServing}g protein
          </p>
        </div>
        <label className="flex shrink-0 flex-col items-end text-xs font-semibold text-ink-soft">
          Serve at
          <input
            type="time"
            value={meal.serveTime}
            onChange={(e) => {
              if (e.target.value) void weekPlansRepo.updateMeal(planId, meal.id, { serveTime: e.target.value });
            }}
            className="mt-1 min-h-11 rounded-lg border border-line bg-surface px-2 text-base font-semibold text-ink"
          />
        </label>
      </div>

      {/* Feedback prompt once serve time passed */}
      {passed && meal.status !== 'skipped' && !tm.logged && (
        <Link
          to="/log"
          className="mt-3 flex min-h-12 items-center justify-between rounded-xl bg-primary px-4 font-semibold text-white"
        >
          How did it go? Log feedback
          <IconChevronRight size={20} />
        </Link>
      )}
      {tm.logged && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-accent">
          <IconCheck size={16} /> Feedback logged
        </p>
      )}

      {/* Cook timeline */}
      {cooking.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Timeline</h3>
            {meal.status === 'planned' && (
              <button
                onClick={() => navigate(`/cook/${meal.id}`)}
                className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-secondary px-4 font-semibold text-white"
              >
                <IconFlame size={18} /> Cook mode
              </button>
            )}
          </div>
          <ol className="flex flex-col gap-1.5">
            {cooking.map((step) => (
              <li key={step.id} className="flex items-baseline gap-2 text-sm">
                <span className="w-12 shrink-0 font-mono font-semibold text-secondary tabular-nums">
                  {formatClock(step.due)}
                </span>
                <span className={step.pastDue && meal.status === 'planned' ? 'text-ink-soft' : ''}>
                  {step.instruction}
                  {step.durationMinutes ? ` (${step.durationMinutes} min)` : ''}
                </span>
              </li>
            ))}
            <li className="flex items-baseline gap-2 text-sm font-bold">
              <span className="w-12 shrink-0 font-mono text-primary tabular-nums">{meal.serveTime}</span>
              <span>Serve</span>
            </li>
          </ol>
        </div>
      )}

      {/* Ingredient checklist */}
      <div className="mt-4">
        <h3 className="mb-1.5 text-sm font-bold">Ingredients</h3>
        <ul className="flex flex-col divide-y divide-line">
          {recipe.ingredients.map((ing) => {
            const ingId = `ing:${ing.name}`;
            const checked = checks.has(ingId);
            const flagged = ranOut.has(ing.name);
            return (
              <li key={ing.name} className="flex items-center gap-2 py-1">
                <button
                  onClick={() => {
                    toggleCheck(meal.id, ingId);
                    setBump((n) => n + 1);
                  }}
                  className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-left"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                      checked ? 'border-accent bg-accent text-white' : 'border-line'
                    }`}
                  >
                    {checked && <IconCheck size={16} strokeWidth={3} />}
                  </span>
                  <span className={`capitalize ${checked ? 'text-ink-soft line-through' : ''}`}>
                    {ing.name}{' '}
                    <span className="text-xs text-ink-soft">
                      {ing.quantity} {ing.unit}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    void markIngredientRanOut(ing.name, recipe.id);
                    setRanOut((s) => new Set(s).add(ing.name));
                  }}
                  disabled={flagged}
                  className={`min-h-11 shrink-0 cursor-pointer rounded-lg px-3 text-xs font-bold ${
                    flagged ? 'text-accent' : 'bg-mist text-secondary'
                  }`}
                >
                  {flagged ? 'On list ✓' : 'Ran out'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
