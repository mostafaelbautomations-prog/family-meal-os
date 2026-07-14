// App-level side effects: app-icon badge for unlogged meals, and best-effort
// local notifications for advance prep steps while the app is open (spec §8).

import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { recipesRepo, settingsRepo, unloggedCookedMeals, weekPlansRepo } from '../db/repo';
import { advanceSteps, mealTimeline } from '../lib/timeline';
import { getChecks } from '../lib/stepChecks';
import { fireStepNotification, setAppBadge } from '../lib/notify';
import { todayISO } from '../lib/dates';

export function BackgroundEffects() {
  const unlogged = useLiveQuery(unloggedCookedMeals);
  const settings = useLiveQuery(() => settingsRepo.get());

  useEffect(() => {
    setAppBadge(unlogged?.length ?? 0);
  }, [unlogged]);

  useEffect(() => {
    if (!settings?.notificationsEnabled) return;

    async function checkDueSteps() {
      const plan = await weekPlansRepo.activePlan();
      const day = plan?.days.find((d) => d.date === todayISO());
      if (!day) return;
      const now = new Date();
      for (const meal of day.meals) {
        if (meal.status !== 'planned') continue;
        const recipe = await recipesRepo.byId(meal.recipeId);
        if (!recipe) continue;
        const checks = getChecks(meal.id);
        for (const step of advanceSteps(mealTimeline(recipe.prepSteps, day.date, meal.serveTime, now))) {
          if (checks.has(step.id)) continue;
          const sinceDue = now.getTime() - step.due.getTime();
          // fire in a 5-minute window after due; older ones stay in-app only
          if (sinceDue >= 0 && sinceDue < 5 * 60_000) {
            fireStepNotification(`${meal.id}:${step.id}`, recipe.name, step.instruction);
          }
        }
      }
    }

    void checkDueSteps();
    const timer = setInterval(() => void checkDueSteps(), 60_000);
    return () => clearInterval(timer);
  }, [settings?.notificationsEnabled]);

  return null;
}
