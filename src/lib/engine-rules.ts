// Retirement rules (spec §6.1). Pure — unit tested. A recipe is a retirement
// CANDIDATE when its latest feedback shows average enjoyment ≤ 2, or ≥2 people
// ate 'little' or less. The engine decides retire vs adjust; these rules just
// flag candidates for the prompt.

import type { AteAmount, MealFeedback } from '../types';

const LOW_INTAKE: AteAmount[] = ['none', 'little'];

export function averageEnjoyment(feedback: MealFeedback): number {
  if (feedback.entries.length === 0) return 0;
  const sum = feedback.entries.reduce((acc, e) => acc + e.enjoyment, 0);
  return sum / feedback.entries.length;
}

export function lowIntakeCount(feedback: MealFeedback): number {
  return feedback.entries.filter((e) => LOW_INTAKE.includes(e.ateAmount)).length;
}

export function isRetirementCandidate(latestFeedback: MealFeedback): boolean {
  return averageEnjoyment(latestFeedback) <= 2 || lowIntakeCount(latestFeedback) >= 2;
}

/** Latest feedback per recipe → set of retirement-candidate recipe ids. */
export function retirementCandidateIds(allFeedback: MealFeedback[]): string[] {
  const latestByRecipe = new Map<string, MealFeedback>();
  for (const fb of allFeedback) {
    const current = latestByRecipe.get(fb.recipeId);
    if (!current || fb.date > current.date) latestByRecipe.set(fb.recipeId, fb);
  }
  return [...latestByRecipe.values()].filter(isRetirementCandidate).map((fb) => fb.recipeId);
}
