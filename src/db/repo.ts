// Typed repository layer — the only module allowed to touch db.* tables.
// Components use these (inside useLiveQuery for reads).

import { db } from './db';
import type {
  AppSettings,
  GroceryItem,
  GrocerySource,
  MealFeedback,
  MealStatus,
  MemberRating,
  PantryStaple,
  Person,
  PersonProfile,
  Recipe,
  RecipePatch,
  RecipeSuggestion,
  StapleLevel,
  SuggestionStatus,
  WeekPlan,
} from '../types';
import type { RatingReply } from '../lib/ratingLinks';
import { normalizeIngredientName } from '../lib/normalize';
import { todayISO, weekStartISO } from '../lib/dates';
import { buildWeekGroceryList } from '../lib/grocery';

const now = () => new Date().toISOString();

// --- People ----------------------------------------------------------------

export const peopleRepo = {
  all: (): Promise<Person[]> => db.people.toArray(),
  rename: (id: string, name: string) => db.people.update(id, { name: name.trim() }),
  setActive: (id: string, active: boolean) => db.people.update(id, { active }),
};

// --- Recipes -----------------------------------------------------------------

export const recipesRepo = {
  byId: (id: string): Promise<Recipe | undefined> => db.recipes.get(id),
  all: (): Promise<Recipe[]> => db.recipes.toArray(),
  active: (): Promise<Recipe[]> => db.recipes.where('status').equals('active').toArray(),
};

// --- Week plans --------------------------------------------------------------

export const weekPlansRepo = {
  activePlan: (): Promise<WeekPlan | undefined> =>
    db.weekPlans.where('status').equals('active').first(),

  /** The active plan covering today's date, if any. */
  currentWeekPlan: async (): Promise<WeekPlan | undefined> => {
    const plan = await db.weekPlans.where('status').equals('active').first();
    if (plan && plan.weekStartDate === weekStartISO(new Date())) return plan;
    return plan; // an active plan for a past week is still the working plan
  },

  byId: (id: string): Promise<WeekPlan | undefined> => db.weekPlans.get(id),
  all: (): Promise<WeekPlan[]> => db.weekPlans.toArray(),

  /** Update one planned meal in place (serve time / status / recipe swap). */
  updateMeal: async (
    planId: string,
    plannedMealId: string,
    patch: Partial<{ serveTime: string; status: MealStatus; recipeId: string }>
  ): Promise<void> => {
    await db.transaction('rw', db.weekPlans, async () => {
      const plan = await db.weekPlans.get(planId);
      if (!plan) throw new Error('Week plan not found');
      for (const day of plan.days) {
        const meal = day.meals.find((m) => m.id === plannedMealId);
        if (meal) Object.assign(meal, patch);
      }
      await db.weekPlans.put(plan);
    });
  },
};

// --- Feedback ----------------------------------------------------------------

export const feedbackRepo = {
  add: (fb: MealFeedback) => db.feedback.add(fb),
  all: (): Promise<MealFeedback[]> => db.feedback.toArray(),
  forRecipe: (recipeId: string): Promise<MealFeedback[]> =>
    db.feedback.where('recipeId').equals(recipeId).toArray(),
  byPlannedMeal: (plannedMealId: string): Promise<MealFeedback | undefined> =>
    db.feedback.where('plannedMealId').equals(plannedMealId).first(),
};

// --- Pantry --------------------------------------------------------------------

export const pantryRepo = {
  all: (): Promise<PantryStaple[]> => db.pantry.toArray(),

  byName: (name: string): Promise<PantryStaple | undefined> =>
    db.pantry.where('name').equals(normalizeIngredientName(name)).first(),

  /**
   * Set a staple's level. Low/out staples auto-appear in the Needed list
   * (source 'staple-low'); returning to stocked removes that auto-row.
   */
  setLevel: async (id: string, level: StapleLevel): Promise<void> => {
    await db.transaction('rw', db.pantry, db.grocery, async () => {
      const staple = await db.pantry.get(id);
      if (!staple) return;
      await db.pantry.update(id, { level, updatedAt: now() });
      if (level === 'low' || level === 'out') {
        await groceryRepo.add(staple.name, 'staple-low');
      } else {
        const autoRows = await db.grocery
          .where('status')
          .equals('needed')
          .filter((g) => g.name === staple.name && g.source === 'staple-low')
          .toArray();
        await db.grocery.bulkDelete(autoRows.map((g) => g.id));
      }
    });
  },

  add: async (name: string): Promise<string> => {
    const id = crypto.randomUUID();
    await db.pantry.add({ id, name: normalizeIngredientName(name), level: 'stocked', updatedAt: now() });
    return id;
  },

  remove: (id: string) => db.pantry.delete(id),
};

// --- Grocery ---------------------------------------------------------------------

export const groceryRepo = {
  all: (): Promise<GroceryItem[]> => db.grocery.toArray(),

  add: async (
    name: string,
    source: GrocerySource,
    opts: { quantity?: string; linkedRecipeIds?: string[] } = {}
  ): Promise<string> => {
    const normalized = normalizeIngredientName(name);
    // One 'needed' row per name: merge instead of duplicating.
    const existing = await db.grocery
      .where('status')
      .equals('needed')
      .filter((g) => g.name === normalized)
      .first();
    if (existing) {
      await db.grocery.update(existing.id, {
        linkedRecipeIds: [...new Set([...existing.linkedRecipeIds, ...(opts.linkedRecipeIds ?? [])])],
      });
      return existing.id;
    }
    const id = crypto.randomUUID();
    await db.grocery.add({
      id,
      name: normalized,
      quantity: opts.quantity,
      source,
      linkedRecipeIds: opts.linkedRecipeIds ?? [],
      status: 'needed',
      addedAt: now(),
    });
    return id;
  },

  /**
   * Move an item between needed/bought. Buying an item that matches a pantry
   * staple restocks that staple (closes the ran-out → buy → stocked loop).
   */
  setStatus: async (id: string, status: 'needed' | 'bought'): Promise<void> => {
    await db.transaction('rw', db.grocery, db.pantry, async () => {
      const item = await db.grocery.get(id);
      if (!item) return;
      await db.grocery.update(id, { status });
      if (status === 'bought') {
        const staple = await db.pantry.where('name').equals(item.name).first();
        if (staple && staple.level !== 'stocked') {
          await db.pantry.update(staple.id, { level: 'stocked', updatedAt: now() });
        }
      }
    });
  },

  remove: (id: string) => db.grocery.delete(id),
  clearBought: () => db.grocery.where('status').equals('bought').delete(),
};

/**
 * Regenerate the auto-recipe portion of the grocery list from a week plan.
 * Called when a plan is accepted (and manually from the Grocery screen).
 * Replaces previous 'auto-recipe' needed rows; merges into rows from other
 * sources rather than duplicating them.
 */
export async function regenerateGroceryFromPlan(planId: string): Promise<number> {
  return db.transaction('rw', db.weekPlans, db.recipes, db.grocery, async () => {
    const plan = await db.weekPlans.get(planId);
    if (!plan) throw new Error('Week plan not found');
    const recipes = new Map((await db.recipes.toArray()).map((r) => [r.id, r]));
    const merged = buildWeekGroceryList(plan, recipes);

    const oldAuto = await db.grocery
      .where('status')
      .equals('needed')
      .filter((g) => g.source === 'auto-recipe')
      .toArray();
    await db.grocery.bulkDelete(oldAuto.map((g) => g.id));

    for (const item of merged) {
      const existing = await db.grocery
        .where('status')
        .equals('needed')
        .filter((g) => g.name === item.name)
        .first();
      if (existing) {
        await db.grocery.update(existing.id, {
          quantity: item.quantity,
          linkedRecipeIds: [...new Set([...existing.linkedRecipeIds, ...item.linkedRecipeIds])],
        });
      } else {
        await db.grocery.add({
          id: crypto.randomUUID(),
          name: item.name,
          quantity: item.quantity,
          source: 'auto-recipe',
          linkedRecipeIds: item.linkedRecipeIds,
          status: 'needed',
          addedAt: now(),
        });
      }
    }
    return merged.length;
  });
}

/** "Ran out" quick action: grocery add + pantry level in one transaction. */
export async function markIngredientRanOut(name: string, recipeId?: string): Promise<void> {
  const normalized = normalizeIngredientName(name);
  await db.transaction('rw', db.grocery, db.pantry, async () => {
    await groceryRepo.add(normalized, 'ran-out', {
      linkedRecipeIds: recipeId ? [recipeId] : [],
    });
    const staple = await db.pantry.where('name').equals(normalized).first();
    if (staple) await db.pantry.update(staple.id, { level: 'out', updatedAt: now() });
  });
}

// --- Member self-ratings (share-link flow) -----------------------------------------

export const ratingsRepo = {
  all: (): Promise<MemberRating[]> => db.ratings.toArray(),

  forMeal: (plannedMealId: string): Promise<MemberRating[]> =>
    db.ratings.where('plannedMealId').equals(plannedMealId).toArray(),

  /** Upsert by (meal, person): re-submitting a link replaces the old rating. */
  saveReply: async (reply: RatingReply): Promise<void> => {
    await db.transaction('rw', db.ratings, async () => {
      const existing = await db.ratings
        .where('plannedMealId')
        .equals(reply.mealId)
        .filter((r) => r.personId === reply.personId)
        .first();
      const record: MemberRating = {
        id: existing?.id ?? crypto.randomUUID(),
        plannedMealId: reply.mealId,
        recipeId: reply.recipeId,
        personId: reply.personId,
        date: reply.date,
        rating: reply.rating,
        enjoyed: reply.enjoyed,
        improve: reply.improve,
        receivedAt: now(),
      };
      await db.ratings.put(record);
    });
  },
};

// --- Profiles -----------------------------------------------------------------------

export const profilesRepo = {
  all: (): Promise<PersonProfile[]> => db.profiles.toArray(),
  forPerson: (personId: string): Promise<PersonProfile | undefined> => db.profiles.get(personId),
  put: (profile: PersonProfile) => db.profiles.put({ ...profile, lastUpdated: now() }),

  /**
   * Append kitchen notes learned from chats or review analysis. Deduped
   * case-insensitively; creates the profile row if the engine never has.
   */
  appendNotes: async (personId: string, notes: string[]): Promise<number> => {
    return db.transaction('rw', db.profiles, async () => {
      const existing = await db.profiles.get(personId);
      const current = existing?.notes ?? [];
      const seen = new Set(current.map((n) => n.trim().toLowerCase()));
      const added = notes.map((n) => n.trim()).filter((n) => n && !seen.has(n.toLowerCase()));
      if (added.length === 0) return 0;
      await db.profiles.put({
        personId,
        likes: existing?.likes ?? [],
        dislikes: existing?.dislikes ?? [],
        patterns: existing?.patterns ?? [],
        notes: [...current, ...added],
        lastUpdated: now(),
      });
      return added.length;
    });
  },
};

// --- Settings ------------------------------------------------------------------------

export const settingsRepo = {
  get: async (): Promise<AppSettings | undefined> => db.settings.get('singleton'),
  update: (patch: Partial<Omit<AppSettings, 'id'>>) => db.settings.update('singleton', patch),
};

// --- Review-driven suggestions (Recipes tab) ---------------------------------------

export const suggestionsRepo = {
  all: (): Promise<RecipeSuggestion[]> => db.suggestions.toArray(),

  forRecipe: (recipeId: string): Promise<RecipeSuggestion[]> =>
    db.suggestions.where('recipeId').equals(recipeId).toArray(),

  pending: (): Promise<RecipeSuggestion[]> =>
    db.suggestions.where('status').equals('pending').toArray(),

  add: (s: RecipeSuggestion) => db.suggestions.add(s),

  /** Mark a suggestion dismissed (or applied) without touching the recipe. */
  resolve: (id: string, status: Exclude<SuggestionStatus, 'pending'>) =>
    db.suggestions.update(id, { status, resolvedAt: now() }),

  /**
   * Replace the open (pending) suggestions for a recipe with a freshly
   * recomputed set. Applied/dismissed/auto rows are history and stay put.
   */
  replacePending: async (recipeId: string, next: RecipeSuggestion[]): Promise<void> => {
    await db.transaction('rw', db.suggestions, async () => {
      const old = await db.suggestions
        .where('recipeId')
        .equals(recipeId)
        .filter((s) => s.status === 'pending')
        .toArray();
      await db.suggestions.bulkDelete(old.map((s) => s.id));
      await db.suggestions.bulkAdd(next);
    });
  },
};

/** The cook agreed with a pending suggestion: apply its patch + close it, atomically. */
export async function applySuggestion(id: string): Promise<void> {
  await db.transaction('rw', db.suggestions, db.recipes, async () => {
    const suggestion = await db.suggestions.get(id);
    if (!suggestion || suggestion.status !== 'pending') return;
    await applyRecipeChatUpdate(suggestion.recipeId, suggestion.patch);
    await db.suggestions.update(id, { status: 'applied' as const, resolvedAt: now() });
  });
}

// --- AI chat write paths -----------------------------------------------------------------

export type RecipePatchFromChat = RecipePatch;

/**
 * Apply a recipe-chat adjustment: version bump + changelog append, never
 * destructive (hard rule #4). Ingredient names arrive pre-normalized from the
 * chat validator.
 */
export async function applyRecipeChatUpdate(recipeId: string, patch: RecipePatchFromChat): Promise<number> {
  return db.transaction('rw', db.recipes, async () => {
    const recipe = await db.recipes.get(recipeId);
    if (!recipe) throw new Error('Recipe not found');
    const nextVersion = recipe.version + 1;
    const update: Partial<Recipe> = {
      version: nextVersion,
      updatedAt: now(),
      changelog: [...recipe.changelog, { date: now(), source: 'ai' as const, summary: patch.changeSummary }],
    };
    if (patch.name) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.method) update.method = patch.method;
    if (patch.ingredients) update.ingredients = patch.ingredients;
    if (patch.nutrition) update.nutrition = { ...patch.nutrition, confidence: 'rough' };
    if (patch.prepSteps) {
      update.prepSteps = patch.prepSteps.map((s) => ({ ...s, id: crypto.randomUUID() }));
    }
    await db.recipes.update(recipeId, update);
    return nextVersion;
  });
}

export interface NewRecipeSpec {
  name: string;
  description: string;
  cuisineTags: string[];
  method: Recipe['method'];
  ingredients: Recipe['ingredients'];
  prepSteps: { order: number; instruction: string; offsetMinutes: number; durationMinutes?: number; type: 'advance' | 'cook' }[];
  nutrition: { caloriesPerServing: number; proteinPerServing: number; carbsPerServing: number; fatPerServing: number };
}

/** Create a recipe from an AI-produced spec (chef chat). Returns the new id. */
export async function createRecipeFromSpec(spec: NewRecipeSpec, originNote: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.recipes.add({
    id,
    name: spec.name,
    description: spec.description,
    cuisineTags: spec.cuisineTags,
    method: spec.method,
    servingsBase: 4,
    ingredients: spec.ingredients,
    prepSteps: spec.prepSteps.map((s) => ({ ...s, id: crypto.randomUUID() })),
    nutrition: { ...spec.nutrition, confidence: 'rough' },
    status: 'active',
    version: 1,
    changelog: [{ date: now(), source: 'ai', summary: originNote }],
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

// --- Cross-cutting helpers --------------------------------------------------------------

/** Cooked meals from the active plan with no feedback row yet (today or earlier). */
export async function unloggedCookedMeals(): Promise<
  { planId: string; date: string; mealId: string; recipeId: string }[]
> {
  const plan = await weekPlansRepo.activePlan();
  if (!plan) return [];
  const logged = new Set((await db.feedback.toArray()).map((f) => f.plannedMealId));
  const result: { planId: string; date: string; mealId: string; recipeId: string }[] = [];
  for (const day of plan.days) {
    if (day.date > todayISO()) continue;
    for (const meal of day.meals) {
      if (meal.status === 'cooked' && !logged.has(meal.id)) {
        result.push({ planId: plan.id, date: day.date, mealId: meal.id, recipeId: meal.recipeId });
      }
    }
  }
  return result;
}
