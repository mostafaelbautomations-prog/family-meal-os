// Prompt assembly for weekly generation (spec §6.2). One typed template
// function used IDENTICALLY by Live and Manual modes (hard rule #3).

import type {
  AppSettings,
  MealFeedback,
  MemberRating,
  PantryStaple,
  Person,
  PersonProfile,
  Recipe,
} from '../types';
import { isWeekendDate } from '../lib/dates';

export interface GenerationInput {
  nextWeekDates: string[]; // 7 ISO dates, Sunday first
  people: Person[];
  profiles: PersonProfile[];
  activeRecipes: Recipe[];
  retiredRecipes: Recipe[];
  feedbackHistory: MealFeedback[]; // last 2–4 weeks, oldest first
  memberRatings: MemberRating[]; // self-ratings via share links, same window
  pantry: PantryStaple[];
  settings: AppSettings;
  retirementCandidateIds: string[];
}

export function buildGenerationPrompt(input: GenerationInput): string {
  const {
    nextWeekDates,
    people,
    profiles,
    activeRecipes,
    retiredRecipes,
    feedbackHistory,
    memberRatings,
    pantry,
    settings,
    retirementCandidateIds,
  } = input;

  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const recipeName = (id: string) =>
    [...activeRecipes, ...retiredRecipes].find((r) => r.id === id)?.name ?? id;

  const dayPlanContract = nextWeekDates
    .map((date) => {
      const weekend = isWeekendDate(date);
      return weekend
        ? `  ${date}: slots "meal1" (suggest ${settings.defaultServeTimeWeekend[0]}) and "meal2" (suggest ${settings.defaultServeTimeWeekend[1]})`
        : `  ${date}: slots "main" (suggest ${settings.defaultServeTimeWeekday}) and "snack" (suggest ${settings.defaultSnackTime})`;
    })
    .join('\n');

  const recipesBlock = activeRecipes
    .map((r) => {
      const candidate = retirementCandidateIds.includes(r.id) ? ' [RETIREMENT CANDIDATE — see rules]' : '';
      const ingredients = r.ingredients
        .map((i) => `${i.name} ${i.quantity}${i.unit}${i.isStaple ? ' (staple)' : ''}`)
        .join(', ');
      return `- id: ${r.id}\n  name: ${r.name} (v${r.version}, ${r.method})${candidate}\n  ingredients: ${ingredients}`;
    })
    .join('\n');

  const retiredBlock =
    retiredRecipes.length === 0
      ? '(none yet)'
      : retiredRecipes.map((r) => `- ${r.name}: ${r.retiredReason ?? 'retired'}`).join('\n');

  const feedbackBlock =
    feedbackHistory.length === 0
      ? '(none yet)'
      : feedbackHistory
          .map((fb) => {
            const entries = fb.entries
              .map(
                (e) =>
                  `${personName(e.personId)}: ate ${e.ateAmount}, enjoyment ${e.enjoyment}/5${e.note ? `, note "${e.note}"` : ''}`
              )
              .join('; ');
            const notes = [
              fb.overallNote && `overall: "${fb.overallNote}"`,
              fb.cookNotes && `cook: "${fb.cookNotes}"`,
            ]
              .filter(Boolean)
              .join(' · ');
            return `- ${fb.date} ${recipeName(fb.recipeId)} [recipeId ${fb.recipeId}] — ${entries}${notes ? ` — ${notes}` : ''}`;
          })
          .join('\n');

  const ratingsBlock =
    memberRatings.length === 0
      ? '(none yet)'
      : memberRatings
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((r) => {
            const bits = [
              r.enjoyed && `enjoyed: "${r.enjoyed}"`,
              r.improve && `improve next time: "${r.improve}"`,
            ]
              .filter(Boolean)
              .join('; ');
            return `- ${r.date} ${recipeName(r.recipeId)} — ${personName(r.personId)} self-rated ${r.rating}/10${bits ? ` — ${bits}` : ''}`;
          })
          .join('\n');

  const profilesBlock = profiles
    .map((p) => {
      const person = people.find((x) => x.id === p.personId);
      if (!person) return null;
      return `- personId ${p.personId} (${person.name}): likes [${p.likes.join(', ')}], dislikes [${p.dislikes.join(', ')}], patterns [${p.patterns.join(', ')}]`;
    })
    .filter(Boolean)
    .join('\n');

  const pantryBlock = pantry.map((s) => `${s.name}: ${s.level}`).join(', ');

  return `You are the weekly meal-planning engine for an Egyptian family of 4. Plan next week's meals from this household's data, improving on last week's feedback.

## Fixed constraints (the constitution)
- 4 servings per meal.
- Sunday–Thursday: 1 main meal + 1 protein-forward snack per day. Friday–Saturday (the weekend): 2 full meals per day, no snack.
- Budget-conscious Egyptian ingredients; rotate cheap proteins (chicken, tilapia, liver, beef shin, eggs, lentils, foul, canned tuna, cottage cheese).
- Every meal must have a clear protein source. Target ~40–50g protein per person at mains.
- An airfryer is available. Prefer oven/grill/stove/airfryer over deep frying.
- Control calories via portions and oil, never by cutting protein.

## Active recipes
${recipesBlock}

## Retired recipes (do NOT re-propose these)
${retiredBlock}

## Feedback history (recent weeks, oldest first)
${feedbackBlock}

## Family self-ratings (each person rated on their own phone, 1–10)
Weigh these heavily — they came straight from the eater, and the "improve next time" notes are direct requests for adjustments.
${ratingsBlock}

## Person preference profiles (update these from feedback)
- ateAmount scale: none < little < half < most < all < seconds. enjoyment: 1 = hated, 5 = loved.
${profilesBlock}

## Pantry staples
${pantryBlock}
Prefer recipes that lean on stocked staples. Avoid recipes needing staples that are out, unless they're on the shopping list anyway.

## Your tasks
1. RETIREMENT: for each recipe marked [RETIREMENT CANDIDATE] (latest feedback: average enjoyment ≤ 2, or ≥ 2 people ate 'little' or less), decide: if notes point to a fixable cause ("too salty", "dry"), propose an adjustment instead; if the family dislikes the dish itself, retire it with a reason. Never schedule a recipe you retire.
2. ADJUSTMENT: for recipes with fixable complaints, output a recipeAdjustments entry — changed ingredients and/or prepSteps (send the COMPLETE new arrays, not diffs), a one-line summary, and the triggering feedback.
3. PLAN: fill every day/slot below using existing recipe ids or new recipes. Introduce AT MOST 2 brand-new recipes this week. Reuse well-loved recipes freely, vary proteins across the week.
4. PROFILES: update every person's likes/dislikes/patterns from the accumulated feedback (send complete replacement arrays).
5. Explain everything in "rationale" in plain language addressed to the cook.

## Required schedule
${dayPlanContract}

## Response format — STRICT JSON ONLY
Reply with a single JSON object and nothing else: no prose, no markdown fences, no comments.

{
  "weekPlan": {
    "days": [
      { "date": "YYYY-MM-DD", "meals": [ { "recipeRef": "existing:<recipeId>" or "new:<index into newRecipes>", "slot": "main|snack|meal1|meal2", "serveTimeSuggestion": "HH:MM" } ] }
    ]
  },
  "newRecipes": [
    {
      "name": "...", "description": "...", "cuisineTags": ["egyptian"],
      "method": "airfryer|stove|oven|grill|slowcook|nocook",
      "ingredients": [ { "name": "lowercase singular", "quantity": 500, "unit": "g", "isStaple": false, "optional": false } ],
      "prepSteps": [ { "order": 1, "instruction": "...", "offsetMinutes": -600, "type": "advance" }, { "order": 2, "instruction": "...", "offsetMinutes": -30, "durationMinutes": 15, "type": "cook" } ],
      "nutrition": { "caloriesPerServing": 550, "proteinPerServing": 45, "carbsPerServing": 40, "fatPerServing": 20 }
    }
  ],
  "recipeAdjustments": [
    { "recipeId": "...", "changes": { "ingredients": [ ... complete array ... ], "prepSteps": [ ... complete array ... ], "nutrition": { ... re-estimated when ingredients change ... } }, "summary": "Reduced salt 2tsp→1tsp", "triggeringFeedback": "Wed: 'too salty'" }
  ],
  "retirements": [ { "recipeId": "...", "reason": "..." } ],
  "profileUpdates": [ { "personId": "...", "likes": [...], "dislikes": [...], "patterns": [...] } ],
  "rationale": "Plain-language summary of everything you changed and why"
}

prepSteps rules: offsetMinutes is relative to serve time (negative = before). type "advance" = defrosting (-480 to -720), marinating (-120 to -180), soaking (-240) — things done hours ahead. type "cook" = the cooking sequence, offsets within -90 to 0. Every recipe with frozen meat needs a defrost advance step. Nutrition is a rough per-serving estimate with all four fields (calories, protein, carbs, fat); whenever an adjustment changes ingredients, re-estimate and include nutrition in that adjustment's changes.`;
}
