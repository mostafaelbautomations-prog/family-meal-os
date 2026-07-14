// Persistence for "done" checkmarks on advance prep steps and the ingredient
// gathering checklist. Lives in localStorage (disposable UI state, not domain
// data) keyed per planned meal so it survives app reopens during the day.

const PREFIX = 'mealos.checks.';

function read(plannedMealId: string): Set<string> {
  try {
    const raw = localStorage.getItem(PREFIX + plannedMealId);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    // Corrupt entry — treat as unchecked rather than crashing the Today view.
    return new Set();
  }
}

function write(plannedMealId: string, ids: Set<string>): void {
  localStorage.setItem(PREFIX + plannedMealId, JSON.stringify([...ids]));
}

export function getChecks(plannedMealId: string): Set<string> {
  return read(plannedMealId);
}

export function toggleCheck(plannedMealId: string, itemId: string): Set<string> {
  const ids = read(plannedMealId);
  if (ids.has(itemId)) ids.delete(itemId);
  else ids.add(itemId);
  write(plannedMealId, ids);
  return ids;
}
