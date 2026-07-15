// Today: the reminder system. Advance-prep checklist on top (red when past
// due), then per-meal cards with editable serve time, cook timeline, the
// ingredient checklist with ran-out quick action, and the log-feedback card
// once serve time has passed.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Screen } from '../components/Screen';
import { feedbackRepo, markIngredientRanOut, recipesRepo, weekPlansRepo } from '../db/repo';
import { formatClock, formatDayLabel, todayISO } from '../lib/dates';
import { advanceSteps, cookSteps, mealTimeline, servePassed } from '../lib/timeline';
import { getChecks, toggleCheck } from '../lib/stepChecks';
import { backupNudgeDue, snoozeNudge } from '../lib/backupNudge';
import { formatMacros, formatMacrosCompact } from '../lib/nutrition';
import { subDays, format } from 'date-fns';
import type { PlannedMeal, Recipe } from '../types';
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconDownload,
  IconFlame,
  IconSparkles,
  IconSwap,
  IconX,
} from '../components/Icons';

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
          <Link
            to="/chef"
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-semibold text-secondary"
          >
            <IconSparkles size={18} /> Not feeling it? Chat with the AI chef
          </Link>
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
                      ? 'border-accent bg-accent text-on-strong'
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

// --- Swap today's meal (favorites / recent / all) --------------------------------

function SwapTodaySheet({
  planId,
  meal,
  currentName,
  onClose,
}: {
  planId: string;
  meal: PlannedMeal;
  currentName: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const groups = useLiveQuery(async () => {
    const [recipes, feedback] = await Promise.all([recipesRepo.active(), feedbackRepo.all()]);
    const pool = recipes.filter((r) => r.id !== meal.recipeId);

    // Average enjoyment + latest date per recipe, across all feedback.
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

    const favorites = pool
      .filter((r) => avg(r.id) >= 4)
      .sort((a, b) => avg(b.id) - avg(a.id));
    const cutoff = format(subDays(new Date(), 14), 'yyyy-MM-dd');
    const favoriteIds = new Set(favorites.map((r) => r.id));
    const recent = pool
      .filter((r) => !favoriteIds.has(r.id) && (stats.get(r.id)?.latest ?? '') >= cutoff)
      .sort((a, b) => (stats.get(b.id)?.latest ?? '').localeCompare(stats.get(a.id)?.latest ?? ''));
    const shownIds = new Set([...favoriteIds, ...recent.map((r) => r.id)]);
    const rest = pool.filter((r) => !shownIds.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));

    return { favorites, recent, rest };
  }, [meal.recipeId]);

  async function pick(recipeId: string) {
    await weekPlansRepo.updateMeal(planId, meal.id, { recipeId });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Swap today's meal"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">Instead of "{currentName}"…</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-mist text-ink-soft"
          >
            <IconX size={20} />
          </button>
        </div>

        <button
          onClick={() => navigate(`/chef?meal=${meal.id}`)}
          className="mb-4 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary font-display text-on-strong"
        >
          <IconSparkles size={18} /> Ask the AI chef for something new
        </button>

        {groups && (
          <>
            <SwapGroup title="Family favorites" recipes={groups.favorites} onPick={pick} />
            <SwapGroup title="Recently cooked" recipes={groups.recent} onPick={pick} />
            <SwapGroup title="All recipes" recipes={groups.rest} onPick={pick} />
            {groups.favorites.length + groups.recent.length + groups.rest.length === 0 && (
              <p className="text-sm text-ink-soft">No other active recipes yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SwapGroup({
  title,
  recipes,
  onPick,
}: {
  title: string;
  recipes: Recipe[];
  onPick: (id: string) => void;
}) {
  if (recipes.length === 0) return null;
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-xs font-bold tracking-wide text-ink-soft uppercase">{title}</h3>
      <ul className="flex flex-col divide-y divide-line">
        {recipes.map((r) => (
          <li key={r.id}>
            <button onClick={() => onPick(r.id)} className="min-h-12 w-full cursor-pointer py-2 text-left">
              <span className="block font-semibold">{r.name}</span>
              <span className="block text-xs text-ink-soft">
                {formatMacrosCompact(r.nutrition)} · {r.method}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- One meal ------------------------------------------------------------------

function MealCard({ tm, date, now }: { tm: TodayMeal; date: string; now: Date }) {
  const { meal, recipe, planId } = tm;
  const navigate = useNavigate();
  const [, setBump] = useState(0);
  const [ranOut, setRanOut] = useState<Set<string>>(new Set());
  const [swapOpen, setSwapOpen] = useState(false);

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
          <p className="mt-0.5 text-sm text-ink-soft">{formatMacros(recipe.nutrition)}</p>
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

      {meal.status === 'planned' && !passed && (
        <button
          onClick={() => setSwapOpen(true)}
          className="mt-2 flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-bold text-secondary"
        >
          <IconSwap size={16} /> Don't want this today? Swap it
        </button>
      )}
      {swapOpen && (
        <SwapTodaySheet
          planId={planId}
          meal={meal}
          currentName={recipe.name}
          onClose={() => setSwapOpen(false)}
        />
      )}

      {/* Feedback prompt once serve time passed */}
      {passed && meal.status !== 'skipped' && !tm.logged && (
        <Link
          to="/log"
          className="mt-3 flex min-h-12 items-center justify-between rounded-xl bg-primary px-4 font-semibold text-on-strong"
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
                className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-secondary px-4 font-semibold text-on-strong"
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
                      checked ? 'border-accent bg-accent text-on-strong' : 'border-line'
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
