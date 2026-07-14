// Full-screen step-by-step cook mode: one cook step per screen, big text,
// built-in countdown timer for steps with a duration, tap to advance.
// Finishing marks the planned meal as cooked.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { recipesRepo, weekPlansRepo } from '../db/repo';
import type { PlannedMeal, PrepStep, Recipe } from '../types';
import { IconCheck, IconChevronLeft, IconChevronRight, IconX } from '../components/Icons';

export function CookModeScreen() {
  const { plannedMealId } = useParams<{ plannedMealId: string }>();
  const navigate = useNavigate();

  const data = useLiveQuery(async () => {
    if (!plannedMealId) return undefined;
    const plan = await weekPlansRepo.activePlan();
    if (!plan) return undefined;
    for (const day of plan.days) {
      const meal = day.meals.find((m) => m.id === plannedMealId);
      if (meal) {
        const recipe = await recipesRepo.byId(meal.recipeId);
        return recipe ? { planId: plan.id, meal, recipe } : undefined;
      }
    }
    return undefined;
  }, [plannedMealId]);

  if (data === undefined) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-cream px-6 text-center">
        <div>
          <p className="text-ink-soft">Meal not found in the active week.</p>
          <button onClick={() => navigate('/')} className="mt-3 min-h-11 cursor-pointer font-semibold text-primary">
            Back to Today
          </button>
        </div>
      </main>
    );
  }

  return <CookSession planId={data.planId} meal={data.meal} recipe={data.recipe} />;
}

function CookSession({ planId, meal, recipe }: { planId: string; meal: PlannedMeal; recipe: Recipe }) {
  const navigate = useNavigate();
  const steps = useMemo(
    () =>
      recipe.prepSteps
        .filter((s) => s.type === 'cook')
        .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.order - b.order),
    [recipe]
  );
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  const step = steps[index] as PrepStep | undefined;

  async function finish() {
    await weekPlansRepo.updateMeal(planId, meal.id, { status: 'cooked' });
    setFinished(true);
  }

  if (finished || !step) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cream px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white">
          <IconCheck size={32} strokeWidth={3} />
        </span>
        <h1 className="font-display text-2xl">{recipe.name} is done!</h1>
        <p className="text-ink-soft">Marked as cooked. Log feedback after the meal.</p>
        <button
          onClick={() => navigate('/')}
          className="min-h-12 cursor-pointer rounded-xl bg-primary px-6 font-semibold text-white"
        >
          Back to Today
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-cream px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          aria-label="Exit cook mode"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-mist text-ink-soft"
        >
          <IconX size={22} />
        </button>
        <p className="font-semibold text-ink-soft">
          {recipe.name} · {index + 1}/{steps.length}
        </p>
        <span className="w-11" />
      </header>

      {/* progress dots */}
      <div className="mt-3 flex gap-1.5">
        {steps.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 flex-1 rounded-full ${i < index ? 'bg-accent' : i === index ? 'bg-primary' : 'bg-line'}`}
          />
        ))}
      </div>

      <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <p className="font-display text-[1.75rem] leading-snug">{step.instruction}</p>
        {step.durationMinutes && <StepTimer key={step.id} minutes={step.durationMinutes} />}
      </section>

      <footer className="flex items-center gap-3">
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-2xl border border-line bg-surface text-ink disabled:opacity-30"
          aria-label="Previous step"
        >
          <IconChevronLeft size={26} />
        </button>
        {index < steps.length - 1 ? (
          <button
            onClick={() => setIndex((i) => i + 1)}
            className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary font-display text-lg text-white"
          >
            Next step <IconChevronRight size={22} />
          </button>
        ) : (
          <button
            onClick={() => void finish()}
            className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-accent font-display text-lg text-white"
          >
            <IconCheck size={22} /> Done — mark cooked
          </button>
        )}
      </footer>
    </main>
  );
}

// --- Countdown timer -----------------------------------------------------------

function StepTimer({ minutes }: { minutes: number }) {
  const total = minutes * 60;
  const [secondsLeft, setSecondsLeft] = useState(total);
  const [running, setRunning] = useState(false);
  const done = secondsLeft === 0;
  const interval = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!running) return;
    interval.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval.current);
          if ('vibrate' in navigator) navigator.vibrate([300, 150, 300]);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval.current);
  }, [running]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  if (done) {
    return (
      <div className="rounded-2xl bg-accent/10 px-8 py-4">
        <p className="font-display text-3xl text-accent">Time's up!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className={`font-mono text-6xl font-bold tabular-nums ${running ? 'text-primary' : 'text-ink-soft'}`}>
        {mm}:{ss}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setRunning((r) => !r)}
          className="min-h-12 cursor-pointer rounded-xl bg-secondary px-6 font-semibold text-white"
        >
          {running ? 'Pause' : secondsLeft === total ? `Start ${minutes} min` : 'Resume'}
        </button>
        {secondsLeft !== total && (
          <button
            onClick={() => {
              setRunning(false);
              setSecondsLeft(total);
            }}
            className="min-h-12 cursor-pointer rounded-xl border border-line bg-surface px-4 font-semibold text-ink-soft"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
