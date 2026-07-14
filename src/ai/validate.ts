// Engine response parsing + validation (spec §6.2). Used identically by Live
// and Manual modes. Forgiving input handling (fence-stripping, trimming),
// strict structural validation with actionable error messages — the error
// string is fed back to the model on retry.

import type { CookMethod, MealSlot, PrepStepType, RecipeIngredient } from '../types';
import { normalizeIngredientName } from '../lib/normalize';
import { isWeekendDate } from '../lib/dates';

// --- Validated response shape ------------------------------------------------

export interface EngineMealRef {
  recipeRef: string; // "existing:<id>" | "new:<index>"
  slot: MealSlot;
  serveTimeSuggestion?: string;
}

export interface EngineNewRecipe {
  name: string;
  description: string;
  cuisineTags: string[];
  method: CookMethod;
  ingredients: RecipeIngredient[];
  prepSteps: {
    order: number;
    instruction: string;
    offsetMinutes: number;
    durationMinutes?: number;
    type: PrepStepType;
  }[];
  nutrition: { caloriesPerServing: number; proteinPerServing: number };
}

export interface EngineAdjustment {
  recipeId: string;
  changes: {
    ingredients?: RecipeIngredient[];
    prepSteps?: EngineNewRecipe['prepSteps'];
  };
  summary: string;
  triggeringFeedback?: string;
}

export interface EngineResponse {
  weekPlan: { days: { date: string; meals: EngineMealRef[] }[] };
  newRecipes: EngineNewRecipe[];
  recipeAdjustments: EngineAdjustment[];
  retirements: { recipeId: string; reason: string }[];
  profileUpdates: { personId: string; likes: string[]; dislikes: string[]; patterns: string[] }[];
  rationale: string;
}

export interface ValidationContext {
  activeRecipeIds: string[];
  personIds: string[];
  expectedDates: string[]; // 7 ISO dates, Sunday first
}

export type ParseResult = { ok: true; data: EngineResponse } | { ok: false; error: string };

const METHODS: CookMethod[] = ['airfryer', 'stove', 'oven', 'grill', 'slowcook', 'nocook'];
const SLOTS: MealSlot[] = ['main', 'snack', 'meal1', 'meal2'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Strip markdown fences / surrounding prose and isolate the JSON object. */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();
  // strip ```json ... ``` fences anywhere they wrap the payload
  text = text.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return text;
  return text.slice(first, last + 1);
}

export function parseEngineResponse(raw: string, ctx: ValidationContext): ParseResult {
  if (!raw.trim()) return fail('The reply was empty. Return the JSON object.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (err) {
    return fail(
      `The reply is not valid JSON (${err instanceof Error ? err.message : 'parse error'}). Return a single JSON object with no prose or markdown fences.`
    );
  }
  if (!isRecord(parsed)) return fail('The top level must be a JSON object.');

  // rationale
  if (typeof parsed.rationale !== 'string' || !parsed.rationale.trim()) {
    return fail('Missing "rationale" (non-empty string).');
  }

  // newRecipes
  if (!Array.isArray(parsed.newRecipes)) return fail('"newRecipes" must be an array (may be empty).');
  if (parsed.newRecipes.length > 2) {
    return fail(`"newRecipes" has ${parsed.newRecipes.length} entries — at most 2 new recipes per week.`);
  }
  const newRecipes: EngineNewRecipe[] = [];
  for (let i = 0; i < parsed.newRecipes.length; i++) {
    const result = validateNewRecipe(parsed.newRecipes[i], `newRecipes[${i}]`);
    if (typeof result === 'string') return fail(result);
    newRecipes.push(result);
  }

  // retirements
  if (!Array.isArray(parsed.retirements)) return fail('"retirements" must be an array (may be empty).');
  const retirements: EngineResponse['retirements'] = [];
  for (let i = 0; i < parsed.retirements.length; i++) {
    const r = parsed.retirements[i];
    if (!isRecord(r) || typeof r.recipeId !== 'string' || typeof r.reason !== 'string') {
      return fail(`retirements[${i}] needs string "recipeId" and "reason".`);
    }
    if (!ctx.activeRecipeIds.includes(r.recipeId)) {
      return fail(`retirements[${i}].recipeId "${r.recipeId}" is not an active recipe id.`);
    }
    retirements.push({ recipeId: r.recipeId, reason: r.reason });
  }
  const retiredIds = new Set(retirements.map((r) => r.recipeId));

  // recipeAdjustments
  if (!Array.isArray(parsed.recipeAdjustments)) {
    return fail('"recipeAdjustments" must be an array (may be empty).');
  }
  const recipeAdjustments: EngineAdjustment[] = [];
  for (let i = 0; i < parsed.recipeAdjustments.length; i++) {
    const a = parsed.recipeAdjustments[i];
    const label = `recipeAdjustments[${i}]`;
    if (!isRecord(a) || typeof a.recipeId !== 'string' || typeof a.summary !== 'string') {
      return fail(`${label} needs string "recipeId" and "summary".`);
    }
    if (!ctx.activeRecipeIds.includes(a.recipeId)) {
      return fail(`${label}.recipeId "${a.recipeId}" is not an active recipe id.`);
    }
    if (!isRecord(a.changes)) return fail(`${label}.changes must be an object.`);
    const changes: EngineAdjustment['changes'] = {};
    if (a.changes.ingredients !== undefined) {
      const ings = validateIngredients(a.changes.ingredients, `${label}.changes.ingredients`);
      if (typeof ings === 'string') return fail(ings);
      changes.ingredients = ings;
    }
    if (a.changes.prepSteps !== undefined) {
      const steps = validatePrepSteps(a.changes.prepSteps, `${label}.changes.prepSteps`);
      if (typeof steps === 'string') return fail(steps);
      changes.prepSteps = steps;
    }
    if (!changes.ingredients && !changes.prepSteps) {
      return fail(`${label}.changes must include "ingredients" and/or "prepSteps".`);
    }
    recipeAdjustments.push({
      recipeId: a.recipeId,
      changes,
      summary: a.summary,
      triggeringFeedback: typeof a.triggeringFeedback === 'string' ? a.triggeringFeedback : undefined,
    });
  }

  // weekPlan
  if (!isRecord(parsed.weekPlan) || !Array.isArray(parsed.weekPlan.days)) {
    return fail('"weekPlan.days" must be an array of 7 days.');
  }
  const days = parsed.weekPlan.days;
  if (days.length !== 7) return fail(`"weekPlan.days" has ${days.length} days — exactly 7 required.`);

  const planDays: EngineResponse['weekPlan']['days'] = [];
  for (let i = 0; i < 7; i++) {
    const day = days[i];
    const expectedDate = ctx.expectedDates[i];
    if (!isRecord(day) || day.date !== expectedDate) {
      return fail(
        `weekPlan.days[${i}].date must be "${expectedDate}" (Sunday-first week), got ${isRecord(day) ? JSON.stringify(day.date) : 'invalid day'}.`
      );
    }
    if (!Array.isArray(day.meals) || day.meals.length !== 2) {
      return fail(`weekPlan.days[${i}] (${expectedDate}) must have exactly 2 meals.`);
    }
    const expectedSlots = isWeekendDate(expectedDate) ? ['meal1', 'meal2'] : ['main', 'snack'];
    const meals: EngineMealRef[] = [];
    for (let m = 0; m < 2; m++) {
      const meal = day.meals[m];
      const label = `weekPlan.days[${i}].meals[${m}]`;
      if (!isRecord(meal) || typeof meal.recipeRef !== 'string') {
        return fail(`${label} needs a string "recipeRef".`);
      }
      if (typeof meal.slot !== 'string' || !SLOTS.includes(meal.slot as MealSlot)) {
        return fail(`${label}.slot must be one of ${SLOTS.join('/')}.`);
      }
      const refError = validateRecipeRef(meal.recipeRef, newRecipes.length, ctx, retiredIds);
      if (refError) return fail(`${label}: ${refError}`);
      let serveTimeSuggestion: string | undefined;
      if (meal.serveTimeSuggestion !== undefined) {
        if (typeof meal.serveTimeSuggestion !== 'string' || !TIME_RE.test(meal.serveTimeSuggestion)) {
          return fail(`${label}.serveTimeSuggestion must be "HH:MM" 24h.`);
        }
        serveTimeSuggestion = meal.serveTimeSuggestion;
      }
      meals.push({ recipeRef: meal.recipeRef, slot: meal.slot as MealSlot, serveTimeSuggestion });
    }
    const gotSlots = meals.map((x) => x.slot).sort();
    if (JSON.stringify(gotSlots) !== JSON.stringify([...expectedSlots].sort())) {
      return fail(
        `weekPlan.days[${i}] (${expectedDate}) must use slots ${expectedSlots.join(' + ')}, got ${meals.map((x) => x.slot).join(' + ')}.`
      );
    }
    planDays.push({ date: expectedDate, meals });
  }

  // profileUpdates
  if (!Array.isArray(parsed.profileUpdates)) return fail('"profileUpdates" must be an array.');
  const profileUpdates: EngineResponse['profileUpdates'] = [];
  for (let i = 0; i < parsed.profileUpdates.length; i++) {
    const p = parsed.profileUpdates[i];
    if (
      !isRecord(p) ||
      typeof p.personId !== 'string' ||
      !isStringArray(p.likes) ||
      !isStringArray(p.dislikes) ||
      !isStringArray(p.patterns)
    ) {
      return fail(`profileUpdates[${i}] needs "personId" plus string arrays "likes", "dislikes", "patterns".`);
    }
    if (!ctx.personIds.includes(p.personId)) {
      return fail(`profileUpdates[${i}].personId "${p.personId}" is not a known person id.`);
    }
    profileUpdates.push({ personId: p.personId, likes: p.likes, dislikes: p.dislikes, patterns: p.patterns });
  }

  return {
    ok: true,
    data: { weekPlan: { days: planDays }, newRecipes, recipeAdjustments, retirements, profileUpdates, rationale: parsed.rationale },
  };
}

// --- helpers -----------------------------------------------------------------

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateRecipeRef(
  ref: string,
  newCount: number,
  ctx: ValidationContext,
  retiredIds: Set<string>
): string | null {
  const existing = ref.match(/^existing:(.+)$/);
  if (existing) {
    const id = existing[1];
    if (!ctx.activeRecipeIds.includes(id)) return `recipeRef "${ref}" is not an active recipe id.`;
    if (retiredIds.has(id)) return `recipeRef "${ref}" is retired in this same plan — don't schedule it.`;
    return null;
  }
  const fresh = ref.match(/^new:(\d+)$/);
  if (fresh) {
    const idx = Number(fresh[1]);
    if (idx >= newCount) return `recipeRef "${ref}" points past newRecipes (length ${newCount}).`;
    return null;
  }
  return `recipeRef "${ref}" must be "existing:<id>" or "new:<index>".`;
}

function validateIngredients(v: unknown, label: string): RecipeIngredient[] | string {
  if (!Array.isArray(v) || v.length === 0) return `${label} must be a non-empty array.`;
  const out: RecipeIngredient[] = [];
  for (let i = 0; i < v.length; i++) {
    const ing = v[i];
    if (
      !isRecord(ing) ||
      typeof ing.name !== 'string' ||
      typeof ing.quantity !== 'number' ||
      !Number.isFinite(ing.quantity) ||
      typeof ing.unit !== 'string'
    ) {
      return `${label}[${i}] needs "name" (string), "quantity" (number), "unit" (string).`;
    }
    out.push({
      name: normalizeIngredientName(ing.name), // hard rule #6: normalize at every write point
      quantity: ing.quantity,
      unit: ing.unit.trim(),
      isStaple: ing.isStaple === true,
      optional: ing.optional === true,
    });
  }
  return out;
}

function validatePrepSteps(v: unknown, label: string): EngineNewRecipe['prepSteps'] | string {
  if (!Array.isArray(v) || v.length === 0) return `${label} must be a non-empty array.`;
  const out: EngineNewRecipe['prepSteps'] = [];
  for (let i = 0; i < v.length; i++) {
    const s = v[i];
    if (
      !isRecord(s) ||
      typeof s.order !== 'number' ||
      typeof s.instruction !== 'string' ||
      typeof s.offsetMinutes !== 'number' ||
      !Number.isFinite(s.offsetMinutes) ||
      (s.type !== 'advance' && s.type !== 'cook')
    ) {
      return `${label}[${i}] needs "order" (number), "instruction" (string), "offsetMinutes" (number), "type" ("advance"|"cook").`;
    }
    if (s.offsetMinutes > 0) {
      return `${label}[${i}].offsetMinutes must be ≤ 0 (minutes before serving).`;
    }
    out.push({
      order: s.order,
      instruction: s.instruction,
      offsetMinutes: s.offsetMinutes,
      durationMinutes:
        typeof s.durationMinutes === 'number' && s.durationMinutes > 0 ? s.durationMinutes : undefined,
      type: s.type,
    });
  }
  return out;
}

function validateNewRecipe(v: unknown, label: string): EngineNewRecipe | string {
  if (!isRecord(v)) return `${label} must be an object.`;
  if (typeof v.name !== 'string' || !v.name.trim()) return `${label}.name must be a non-empty string.`;
  if (typeof v.description !== 'string') return `${label}.description must be a string.`;
  if (typeof v.method !== 'string' || !METHODS.includes(v.method as CookMethod)) {
    return `${label}.method must be one of ${METHODS.join('/')}.`;
  }
  const ingredients = validateIngredients(v.ingredients, `${label}.ingredients`);
  if (typeof ingredients === 'string') return ingredients;
  const prepSteps = validatePrepSteps(v.prepSteps, `${label}.prepSteps`);
  if (typeof prepSteps === 'string') return prepSteps;
  if (
    !isRecord(v.nutrition) ||
    typeof v.nutrition.caloriesPerServing !== 'number' ||
    typeof v.nutrition.proteinPerServing !== 'number'
  ) {
    return `${label}.nutrition needs numeric "caloriesPerServing" and "proteinPerServing".`;
  }
  return {
    name: v.name.trim(),
    description: v.description,
    cuisineTags: isStringArray(v.cuisineTags) ? v.cuisineTags : [],
    method: v.method as CookMethod,
    ingredients,
    prepSteps,
    nutrition: {
      // hard rule #7: nutrition is rough — round kcal to 25, protein to 5
      caloriesPerServing: Math.round(v.nutrition.caloriesPerServing / 25) * 25,
      proteinPerServing: Math.round(v.nutrition.proteinPerServing / 5) * 5,
    },
  };
}
