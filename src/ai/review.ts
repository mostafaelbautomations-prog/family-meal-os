// Review analysis: turn the family's reviews of a recipe (cook-logged
// feedback + member self-ratings) into concrete recipe changes.
//   - ≥3 supporters (or all of a 2-person household) → applied automatically ('auto')
//   - ≥2 supporters                                  → 'pending' chip in the Recipes tab
//   - single voice                                   → dropped (weekly engine still sees it)
// Each run is a stateless recompute: the model returns the CURRENT set of open
// suggestions (supporters grow as more reviews arrive) and we replace the
// pending rows. Applied/dismissed summaries are passed as "never re-suggest".
// It also extracts durable per-person insights, appended to profile notes.

import { db } from '../db/db';
import { applyRecipeChatUpdate, profilesRepo, suggestionsRepo } from '../db/repo';
import { classifySuggestion } from '../lib/suggestions';
import { callClaude } from './client';
import { familyBlock, validatePersonNotes, validateRecipePatch, type PersonNote } from './chat';
import { extractJsonObject, isRecord, METHODS } from './validate';
import type {
  MealFeedback,
  MemberRating,
  Person,
  PersonProfile,
  Recipe,
  RecipePatch,
  RecipeSuggestion,
} from '../types';

// --- Input assembly ---------------------------------------------------------------

export interface ReviewInput {
  recipe: Recipe;
  people: Person[]; // active members
  profiles: PersonProfile[];
  feedback: MealFeedback[];
  ratings: MemberRating[];
  /** Summaries the cook already applied/dismissed — the model must not repeat them. */
  handledSummaries: string[];
  /** Open suggestions to recompute (supporters may have grown). */
  openSuggestions: { summary: string; supporters: string[] }[]; // supporters = names
}

export interface AssembledReview {
  input: ReviewInput;
  prompt: string;
  reviewCount: number;
}

/** Total reviews on file for a recipe (feedback rows + member ratings). */
export async function reviewCount(recipeId: string): Promise<number> {
  const [fb, rt] = await Promise.all([
    db.feedback.where('recipeId').equals(recipeId).count(),
    db.ratings.where('recipeId').equals(recipeId).count(),
  ]);
  return fb + rt;
}

export async function assembleReview(recipeId: string): Promise<AssembledReview> {
  const [recipe, people, profiles, feedback, ratings, suggestions] = await Promise.all([
    db.recipes.get(recipeId),
    db.people.toArray(),
    db.profiles.toArray(),
    db.feedback.where('recipeId').equals(recipeId).toArray(),
    db.ratings.where('recipeId').equals(recipeId).toArray(),
    suggestionsRepo.forRecipe(recipeId),
  ]);
  if (!recipe) throw new Error('Recipe not found');

  const activePeople = people.filter((p) => p.active);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'someone';

  const input: ReviewInput = {
    recipe,
    people: activePeople,
    profiles,
    feedback: feedback.sort((a, b) => a.date.localeCompare(b.date)),
    ratings: ratings.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
    handledSummaries: suggestions.filter((s) => s.status !== 'pending').map((s) => s.summary),
    openSuggestions: suggestions
      .filter((s) => s.status === 'pending')
      .map((s) => ({ summary: s.summary, supporters: s.supporters.map(name) })),
  };

  return {
    input,
    prompt: buildReviewPrompt(input),
    reviewCount: feedback.length + ratings.length,
  };
}

// --- Prompt -------------------------------------------------------------------------

export function buildReviewPrompt(input: ReviewInput): string {
  const { recipe, people, profiles, feedback, ratings } = input;
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'someone';

  const feedbackLines = feedback
    .slice(-10)
    .flatMap((f) => [
      ...f.entries.map(
        (e) => `- ${f.date} ${name(e.personId)}: ate ${e.ateAmount}, enjoyment ${e.enjoyment}/5${e.note ? ` — "${e.note}"` : ''}`
      ),
      ...(f.cookNotes ? [`- ${f.date} cook's note: "${f.cookNotes}"`] : []),
      ...(f.overallNote ? [`- ${f.date} overall: "${f.overallNote}"`] : []),
    ])
    .join('\n');

  const ratingLines = ratings
    .slice(-12)
    .map(
      (r) =>
        `- ${r.date} ${name(r.personId)}: ${r.rating}/10${r.enjoyed ? `; enjoyed: "${r.enjoyed}"` : ''}${r.improve ? `; improve next time: "${r.improve}"` : ''}`
    )
    .join('\n');

  const current = {
    name: recipe.name,
    description: recipe.description,
    method: recipe.method,
    servings: recipe.servingsBase,
    ingredients: recipe.ingredients,
    prepSteps: recipe.prepSteps.map(({ order, instruction, offsetMinutes, durationMinutes, type }) => ({
      order,
      instruction,
      offsetMinutes,
      durationMinutes,
      type,
    })),
    nutrition: recipe.nutrition,
  };

  return `You are the quality engine of a family meal planner. Read every review of ONE recipe and distil it into (a) concrete recipe changes with EXACTLY who supports each, and (b) durable facts about individual family members.

## Active family members (use these exact names)
${people.map((p) => p.name).join(', ')}

## Family profiles so far
${familyBlock({ people, profiles })}

## The recipe as it stands
${JSON.stringify(current, null, 2)}

## Cook-logged feedback (oldest first)
${feedbackLines || '(none)'}

## Members' own ratings (oldest first)
${ratingLines || '(none)'}

## Already handled — NEVER suggest these again
${input.handledSummaries.map((s) => `- ${s}`).join('\n') || '(nothing yet)'}

## Currently open suggestions — recompute these with up-to-date supporters
${input.openSuggestions.map((s) => `- "${s.summary}" (${s.supporters.join(', ')})`).join('\n') || '(none)'}

## How to respond — STRICT JSON ONLY, no prose, no markdown fences
{
  "suggestions": [
    {
      "summary": "Short chip label, e.g. 'Add more spice'",
      "supporters": ["exact member names whose reviews genuinely back this change"],
      "updatedRecipe": {
        "description": "... include ONLY fields that change ...",
        "method": "${METHODS.join('|')}",
        "ingredients": [ COMPLETE array if it changes — {"name":"lowercase singular","quantity":1,"unit":"g","isStaple":false,"optional":false} ],
        "prepSteps": [ COMPLETE array if it changes — {"order":1,"instruction":"...","offsetMinutes":-30,"durationMinutes":15,"type":"advance|cook"} ],
        "nutrition": { "caloriesPerServing": 550, "proteinPerServing": 45, "carbsPerServing": 40, "fatPerServing": 20 },
        "changeSummary": "One line for the recipe's changelog"
      }
    }
  ],
  "personInsights": [ {"person": "exact member name", "note": "durable fact/rule, phrased as a kitchen instruction"} ]
}

Rules:
- A suggestion needs at least 2 genuine supporters; return the FULL current set of open suggestions (including recomputed ones above), [] if none.
- Only count someone as a supporter if THEIR OWN words point at the change. Do not stretch.
- Every updatedRecipe must be immediately applicable: complete ingredients/prepSteps arrays when included; re-estimated "nutrition" whenever ingredients change; always a "changeSummary".
- personInsights: lasting facts about ONE person's tastes or serving needs that recur in their reviews (e.g. "doesn't like vegetables mixed in — plate their portion first"). Not one-off comments. Skip anything already in the profiles. [] if none.`;
}

// --- Parse ---------------------------------------------------------------------------

export interface ReviewSuggestionOut {
  summary: string;
  supporterIds: string[];
  supporterNames: string[];
  patch: RecipePatch;
}

export interface ReviewAnalysis {
  suggestions: ReviewSuggestionOut[];
  personInsights: PersonNote[];
}

export function parseReviewAnalysis(
  raw: string,
  people: Person[]
): { ok: true; data: ReviewAnalysis } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return { ok: false, error: 'The reply is not valid JSON. Return a single JSON object, no prose or fences.' };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.suggestions)) {
    return { ok: false, error: 'Missing "suggestions" (array, possibly empty).' };
  }

  const suggestions: ReviewSuggestionOut[] = [];
  for (const [i, s] of parsed.suggestions.entries()) {
    if (!isRecord(s) || typeof s.summary !== 'string' || !s.summary.trim()) {
      return { ok: false, error: `suggestions[${i}]: "summary" (non-empty string) is required.` };
    }
    if (!Array.isArray(s.supporters) || s.supporters.length === 0) {
      return { ok: false, error: `suggestions[${i}]: "supporters" must be a non-empty array of member names.` };
    }
    const supporterIds: string[] = [];
    const supporterNames: string[] = [];
    for (const nameRaw of s.supporters) {
      if (typeof nameRaw !== 'string') {
        return { ok: false, error: `suggestions[${i}]: supporters must be strings.` };
      }
      const person = people.find((p) => p.name.trim().toLowerCase() === nameRaw.trim().toLowerCase());
      if (!person) {
        return {
          ok: false,
          error: `suggestions[${i}]: "${nameRaw}" is not an active member (${people.map((p) => p.name).join(', ')}). Use exact names.`,
        };
      }
      if (!supporterIds.includes(person.id)) {
        supporterIds.push(person.id);
        supporterNames.push(person.name);
      }
    }
    const patch = validateRecipePatch(s.updatedRecipe, `suggestions[${i}].updatedRecipe`);
    if (typeof patch === 'string') return { ok: false, error: patch };
    suggestions.push({ summary: s.summary.trim().slice(0, 80), supporterIds, supporterNames, patch });
  }

  const personInsights = validatePersonNotes(parsed.personInsights, people);
  if (typeof personInsights === 'string') return { ok: false, error: personInsights };

  return { ok: true, data: { suggestions, personInsights } };
}

// --- Apply ---------------------------------------------------------------------------

export interface ReviewOutcome {
  autoApplied: RecipeSuggestion[];
  queued: RecipeSuggestion[];
  insightsSaved: number;
}

/**
 * Commit an analysis: auto-apply unanimous changes (version bump per hard
 * rule #4), replace the pending chips with the recomputed set, append person
 * insights to profiles, and remember how many reviews were covered.
 */
export async function applyReviewAnalysis(recipeId: string, analysis: ReviewAnalysis): Promise<ReviewOutcome> {
  const now = new Date().toISOString();

  const outcome = await db.transaction('rw', [db.recipes, db.suggestions, db.profiles, db.people], async () => {
    const people = await db.people.toArray();
    const activeIds = people.filter((p) => p.active).map((p) => p.id);

    const autoApplied: RecipeSuggestion[] = [];
    const queued: RecipeSuggestion[] = [];

    for (const s of analysis.suggestions) {
      const verdict = classifySuggestion(s.supporterIds, activeIds);
      if (verdict === 'skip') continue;
      const row: RecipeSuggestion = {
        id: crypto.randomUUID(),
        recipeId,
        summary: s.summary,
        supporters: s.supporterIds,
        patch: s.patch,
        status: verdict === 'auto' ? 'auto' : 'pending',
        createdAt: now,
        resolvedAt: verdict === 'auto' ? now : undefined,
      };
      if (verdict === 'auto') {
        await applyRecipeChatUpdate(recipeId, {
          ...s.patch,
          changeSummary: `${s.patch.changeSummary} (${s.supporterNames.join(', ')} agreed)`,
        });
        await suggestionsRepo.add(row);
        autoApplied.push(row);
      } else {
        queued.push(row);
      }
    }

    await suggestionsRepo.replacePending(recipeId, queued);

    let insightsSaved = 0;
    for (const insight of analysis.personInsights) {
      insightsSaved += await profilesRepo.appendNotes(insight.personId, [insight.note]);
    }

    return { autoApplied, queued, insightsSaved };
  });

  markReviewsAnalyzed(recipeId, await reviewCount(recipeId));
  return outcome;
}

// --- "New reviews" bookkeeping (localStorage — disposable UI state) --------------------

const MARK_PREFIX = 'mealos.reviewsAnalyzed.';

export function markReviewsAnalyzed(recipeId: string, count: number): void {
  localStorage.setItem(MARK_PREFIX + recipeId, String(count));
}

export function analyzedReviewCount(recipeId: string): number {
  const raw = localStorage.getItem(MARK_PREFIX + recipeId);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Reviews that arrived since the last analysis run for this recipe. */
export async function newReviewCount(recipeId: string): Promise<number> {
  const total = await reviewCount(recipeId);
  return Math.max(0, total - analyzedReviewCount(recipeId));
}

// --- Live runner (one retry, mirroring the engine and the chats) ------------------------

export type LiveReviewResult =
  | { ok: true; outcome: ReviewOutcome }
  | { ok: false; error: string; promptForManual: string };

export async function runLiveReview(recipeId: string, apiKey: string): Promise<LiveReviewResult> {
  const { input, prompt } = await assembleReview(recipeId);

  let raw: string;
  try {
    raw = await callClaude(prompt, apiKey);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed', promptForManual: prompt };
  }

  let parsed = parseReviewAnalysis(raw, input.people);
  if (!parsed.ok) {
    try {
      raw = await callClaude(
        `${prompt}\n\nYour previous reply failed validation with this error:\n${parsed.error}\nReturn the corrected strict JSON only.`,
        apiKey
      );
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Request failed', promptForManual: prompt };
    }
    parsed = parseReviewAnalysis(raw, input.people);
    if (!parsed.ok) {
      return { ok: false, error: `Claude's reply didn't validate: ${parsed.error}`, promptForManual: prompt };
    }
  }

  const outcome = await applyReviewAnalysis(recipeId, parsed.data);
  return { ok: true, outcome };
}

/** Manual-mode parity: paste Claude's reply, get the same commit path. */
export async function importManualReview(
  recipeId: string,
  raw: string,
  people: Person[]
): Promise<{ ok: true; outcome: ReviewOutcome } | { ok: false; error: string }> {
  const parsed = parseReviewAnalysis(raw, people);
  if (!parsed.ok) return parsed;
  const outcome = await applyReviewAnalysis(recipeId, parsed.data);
  return { ok: true, outcome };
}
