// Engine orchestration (spec §6): assemble input from the DB, run Live
// generation with one validation retry, hold the validated draft until the
// user accepts, then commit EVERYTHING in one Dexie transaction (hard rule #5).

import { addDays, parseISO, format, subDays } from 'date-fns';
import { db } from '../db/db';
import { regenerateGroceryFromPlan } from '../db/repo';
import { retirementCandidateIds } from '../lib/engine-rules';
import { todayISO, weekDates, weekStartISO } from '../lib/dates';
import { buildGenerationPrompt, type GenerationInput } from './prompts';
import { parseEngineResponse, type EngineResponse, type ValidationContext } from './validate';
import { callClaudeForPlan } from './client';
import type { AppSettings, DayPlan, PrepStep, Recipe, RecipeIngredient, WeekPlan } from '../types';

// --- Input assembly ----------------------------------------------------------

export interface AssembledGeneration {
  input: GenerationInput;
  prompt: string;
  ctx: ValidationContext;
}

export async function assembleGeneration(): Promise<AssembledGeneration> {
  const [people, profiles, recipes, allFeedback, allRatings, pantry, settings] = await Promise.all([
    db.people.toArray(),
    db.profiles.toArray(),
    db.recipes.toArray(),
    db.feedback.toArray(),
    db.ratings.toArray(),
    db.pantry.toArray(),
    db.settings.get('singleton'),
  ]);
  if (!settings) throw new Error('Settings missing — reload the app.');

  const activeRecipes = recipes.filter((r) => r.status === 'active');
  const retiredRecipes = recipes.filter((r) => r.status === 'retired');

  // Next week = the Sunday after the current week's Sunday.
  const currentWeekStart = weekStartISO(new Date());
  const nextWeekStart = format(addDays(parseISO(currentWeekStart), 7), 'yyyy-MM-dd');
  const nextWeekDates = weekDates(nextWeekStart);

  // Last 4 weeks of feedback, oldest first.
  const cutoff = format(subDays(new Date(), 28), 'yyyy-MM-dd');
  const feedbackHistory = allFeedback
    .filter((f) => f.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));

  const activePeople = people.filter((p) => p.active);

  const input: GenerationInput = {
    nextWeekDates,
    people: activePeople,
    profiles: profiles.filter((p) => activePeople.some((x) => x.id === p.personId)),
    activeRecipes,
    retiredRecipes,
    feedbackHistory,
    memberRatings: allRatings.filter((r) => r.date >= cutoff),
    pantry,
    settings,
    retirementCandidateIds: retirementCandidateIds(allFeedback),
  };

  return {
    input,
    prompt: buildGenerationPrompt(input),
    ctx: {
      activeRecipeIds: activeRecipes.map((r) => r.id),
      personIds: activePeople.map((p) => p.id),
      expectedDates: nextWeekDates,
    },
  };
}

/** ≥1 feedback entry logged for the current week — gates "Generate next week". */
export async function generationUnlocked(): Promise<boolean> {
  const currentWeekStart = weekStartISO(new Date());
  const count = await db.feedback.where('date').aboveOrEqual(currentWeekStart).count();
  return count > 0;
}

// --- Draft (validated response awaiting Accept) --------------------------------

export interface EngineDraft {
  response: EngineResponse;
  expectedDates: string[];
  createdAt: string;
  mode: 'live' | 'manual';
}

const DRAFT_KEY = 'mealos.pendingDraft';

export function saveDraft(draft: EngineDraft): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function loadDraft(): EngineDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as EngineDraft;
    // A draft for a week that already started is stale.
    if (draft.expectedDates[0] <= todayISO()) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    localStorage.removeItem(DRAFT_KEY);
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

// --- Live generation with one retry ----------------------------------------------

export type LiveResult =
  | { ok: true; draft: EngineDraft }
  | { ok: false; error: string; promptForManual: string };

export async function runLiveGeneration(
  apiKey: string,
  onStatus: (status: string) => void
): Promise<LiveResult> {
  const { prompt, ctx } = await assembleGeneration();

  onStatus('Asking Claude to plan next week…');
  let raw: string;
  try {
    raw = await callClaudeForPlan(prompt, apiKey);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed', promptForManual: prompt };
  }

  let parsed = parseEngineResponse(raw, ctx);
  if (!parsed.ok) {
    // One automatic retry with the validation error appended (spec §6.2).
    onStatus('Reply had problems — asking Claude to fix it…');
    const retryPrompt = `${prompt}\n\nYour previous reply failed validation with this error:\n${parsed.error}\nReturn the corrected response as strict JSON only — no prose, no fences.`;
    try {
      raw = await callClaudeForPlan(retryPrompt, apiKey);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Request failed', promptForManual: prompt };
    }
    parsed = parseEngineResponse(raw, ctx);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `Claude's reply didn't validate after a retry (${parsed.error}). Use Manual mode below — the prompt is ready to copy.`,
        promptForManual: prompt,
      };
    }
  }

  const draft: EngineDraft = {
    response: parsed.data,
    expectedDates: ctx.expectedDates,
    createdAt: new Date().toISOString(),
    mode: 'live',
  };
  saveDraft(draft);
  return { ok: true, draft };
}

// --- Accept: single atomic commit (hard rule #5) -----------------------------------

export async function acceptDraft(draft: EngineDraft): Promise<string> {
  const now = new Date().toISOString();
  const { response } = draft;

  const planId = await db.transaction(
    'rw',
    [db.recipes, db.weekPlans, db.profiles, db.grocery, db.settings],
    async () => {
      // 1. Create new recipes; map "new:<index>" → generated id.
      const newIds: string[] = [];
      for (const nr of response.newRecipes) {
        const id = crypto.randomUUID();
        newIds.push(id);
        const recipe: Recipe = {
          id,
          name: nr.name,
          description: nr.description,
          cuisineTags: nr.cuisineTags,
          method: nr.method,
          servingsBase: 4,
          ingredients: nr.ingredients,
          prepSteps: nr.prepSteps.map(
            (s): PrepStep => ({
              id: crypto.randomUUID(),
              order: s.order,
              instruction: s.instruction,
              offsetMinutes: s.offsetMinutes,
              durationMinutes: s.durationMinutes,
              type: s.type,
            })
          ),
          nutrition: { ...nr.nutrition, confidence: 'rough' },
          status: 'active',
          version: 1,
          changelog: [{ date: now, source: 'ai', summary: 'Created by the weekly engine' }],
          createdAt: now,
          updatedAt: now,
        };
        await db.recipes.add(recipe);
      }

      // 2. Adjustments: bump version, append changelog — never destructive (hard rule #4).
      for (const adj of response.recipeAdjustments) {
        const recipe = await db.recipes.get(adj.recipeId);
        if (!recipe) throw new Error(`Adjustment target ${adj.recipeId} not found`);
        const patch: Partial<Recipe> = {
          version: recipe.version + 1,
          updatedAt: now,
          changelog: [
            ...recipe.changelog,
            {
              date: now,
              source: 'ai' as const,
              summary: adj.triggeringFeedback ? `${adj.summary} — ${adj.triggeringFeedback}` : adj.summary,
            },
          ],
        };
        if (adj.changes.ingredients) {
          patch.ingredients = adj.changes.ingredients as RecipeIngredient[];
        }
        if (adj.changes.nutrition) {
          patch.nutrition = { ...adj.changes.nutrition, confidence: 'rough' };
        }
        if (adj.changes.prepSteps) {
          patch.prepSteps = adj.changes.prepSteps.map(
            (s): PrepStep => ({
              id: crypto.randomUUID(),
              order: s.order,
              instruction: s.instruction,
              offsetMinutes: s.offsetMinutes,
              durationMinutes: s.durationMinutes,
              type: s.type,
            })
          );
        }
        await db.recipes.update(adj.recipeId, patch);
      }

      // 3. Retirements: status flip only — rows are never deleted (hard rule #4).
      for (const ret of response.retirements) {
        await db.recipes.update(ret.recipeId, {
          status: 'retired' as const,
          retiredReason: ret.reason,
          updatedAt: now,
        });
      }

      // 4. Profile updates.
      for (const pu of response.profileUpdates) {
        await db.profiles.put({
          personId: pu.personId,
          likes: pu.likes,
          dislikes: pu.dislikes,
          patterns: pu.patterns,
          lastUpdated: now,
        });
      }

      // 5. New week plan becomes active; the old active plan completes.
      const settings = (await db.settings.get('singleton')) as AppSettings;
      const oldActive = await db.weekPlans.where('status').equals('active').toArray();
      for (const plan of oldActive) {
        await db.weekPlans.update(plan.id, { status: 'completed' as const });
      }

      const days: DayPlan[] = response.weekPlan.days.map((day) => ({
        date: day.date,
        meals: day.meals.map((meal) => {
          const existing = meal.recipeRef.match(/^existing:(.+)$/);
          const recipeId = existing ? existing[1] : newIds[Number(meal.recipeRef.slice(4))];
          const fallbackTime =
            meal.slot === 'main'
              ? settings.defaultServeTimeWeekday
              : meal.slot === 'snack'
                ? settings.defaultSnackTime
                : meal.slot === 'meal1'
                  ? settings.defaultServeTimeWeekend[0]
                  : settings.defaultServeTimeWeekend[1];
          return {
            id: crypto.randomUUID(),
            recipeId,
            slot: meal.slot,
            serveTime: meal.serveTimeSuggestion ?? fallbackTime,
            status: 'planned' as const,
          };
        }),
      }));

      const plan: WeekPlan = {
        id: crypto.randomUUID(),
        weekStartDate: draft.expectedDates[0],
        status: 'active',
        generatedBy: 'ai',
        aiRationale: response.rationale,
        days,
      };
      await db.weekPlans.add(plan);

      // 6. Regenerate the grocery list from the accepted plan.
      await regenerateGroceryFromPlan(plan.id);

      return plan.id;
    }
  );

  clearDraft();
  return planId;
}
