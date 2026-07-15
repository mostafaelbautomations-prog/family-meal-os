// Chat contracts for the two conversational features:
//  1. Recipe tweaker — live-alter an existing recipe from the recipe screen
//  2. AI chef — "here's what I have / what I'm craving" → a brand-new recipe
// Both work identically in Live (API) and Manual (copy/paste) modes: the
// prompt carries the full conversation, so a single-turn exchange in claude.ai
// produces the same result as the API call (hard rule #3's spirit).

import type { PantryStaple, Person, PersonProfile, Recipe } from '../types';
import {
  extractJsonObject,
  isRecord,
  METHODS,
  validateIngredients,
  validateNewRecipe,
  validateNutrition,
  validatePrepSteps,
  type EngineNewRecipe,
  type EngineNutrition,
} from './validate';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

function transcript(history: ChatTurn[]): string {
  if (history.length === 0) return '(none yet — this is the first message)';
  return history
    .slice(-12)
    .map((t) => (t.role === 'user' ? `Cook: ${t.text}` : `You replied: ${t.text}`))
    .join('\n');
}

const HOUSEHOLD = `Household facts: Egyptian family of 4, budget-conscious, airfryer available, prefers oven/grill/stove/airfryer over deep frying. Every meal needs a clear protein source. Nutrition values are rough per-serving estimates with all four fields: caloriesPerServing, proteinPerServing, carbsPerServing, fatPerServing.`;

// --- 1. Recipe tweaker ---------------------------------------------------------

export interface RecipeChatReply {
  reply: string;
  updatedRecipe?: {
    name?: string;
    description?: string;
    method?: Recipe['method'];
    ingredients?: Recipe['ingredients'];
    prepSteps?: EngineNewRecipe['prepSteps'];
    nutrition?: EngineNutrition;
    changeSummary: string;
  };
}

export function buildRecipeChatPrompt(recipe: Recipe, history: ChatTurn[], userMessage: string): string {
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

  return `You are a hands-on kitchen assistant helping the family cook adjust ONE recipe, live, while they look at it. Answer questions and apply requested changes — technique, spice level, crispness, cooking method or tool, calories/macros, ingredient swaps based on what they actually have.

${HOUSEHOLD}

## The recipe as it stands
${JSON.stringify(current, null, 2)}

## Conversation so far
${transcript(history)}

## The cook just said
"${userMessage}"

## How to respond — STRICT JSON ONLY, no prose, no markdown fences
{
  "reply": "Talk to the cook: what you changed and why, or the answer to their question. Plain English, brief.",
  "updatedRecipe": null OR {
    "name": "... (only if it should change)",
    "description": "...",
    "method": "${METHODS.join('|')}",
    "ingredients": [ COMPLETE new array — every ingredient, not a diff — {"name":"lowercase singular","quantity":1,"unit":"g","isStaple":false,"optional":false} ],
    "prepSteps": [ COMPLETE new array — {"order":1,"instruction":"...","offsetMinutes":-30,"durationMinutes":15,"type":"advance|cook"} ],
    "nutrition": { "caloriesPerServing": 550, "proteinPerServing": 45, "carbsPerServing": 40, "fatPerServing": 20 },
    "changeSummary": "One line for the recipe's changelog, e.g. 'Made it spicy: added chili + cayenne, seared hotter'"
  }
}

Rules:
- Pure question ("why soak the lentils?") → "updatedRecipe": null.
- Any change → include ONLY the fields that change, but ingredients/prepSteps must be COMPLETE arrays when included, and whenever ingredients change include re-estimated "nutrition".
- Changing doneness/texture (e.g. "crispy and charred, not juicy") usually means rewriting prepSteps and maybe method — do it.
- prepSteps offsets: negative minutes before serving; "advance" for defrost/marinate/soak hours ahead, "cook" within -90..0.
- Keep it 4 servings, budget-friendly, protein intact unless asked otherwise.`;
}

export function parseRecipeChatReply(raw: string): { ok: true; data: RecipeChatReply } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return { ok: false, error: 'The reply is not valid JSON. Return a single JSON object, no prose or fences.' };
  }
  if (!isRecord(parsed) || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { ok: false, error: 'Missing "reply" (non-empty string).' };
  }
  if (parsed.updatedRecipe === null || parsed.updatedRecipe === undefined) {
    return { ok: true, data: { reply: parsed.reply } };
  }
  const u = parsed.updatedRecipe;
  if (!isRecord(u)) return { ok: false, error: '"updatedRecipe" must be null or an object.' };
  if (typeof u.changeSummary !== 'string' || !u.changeSummary.trim()) {
    return { ok: false, error: '"updatedRecipe.changeSummary" (one line for the changelog) is required.' };
  }

  const out: NonNullable<RecipeChatReply['updatedRecipe']> = { changeSummary: u.changeSummary.trim() };
  if (u.name !== undefined) {
    if (typeof u.name !== 'string' || !u.name.trim()) return { ok: false, error: '"updatedRecipe.name" must be a non-empty string.' };
    out.name = u.name.trim();
  }
  if (u.description !== undefined) {
    if (typeof u.description !== 'string') return { ok: false, error: '"updatedRecipe.description" must be a string.' };
    out.description = u.description;
  }
  if (u.method !== undefined) {
    if (typeof u.method !== 'string' || !METHODS.includes(u.method as Recipe['method'])) {
      return { ok: false, error: `"updatedRecipe.method" must be one of ${METHODS.join('/')}.` };
    }
    out.method = u.method as Recipe['method'];
  }
  if (u.ingredients !== undefined) {
    const ings = validateIngredients(u.ingredients, 'updatedRecipe.ingredients');
    if (typeof ings === 'string') return { ok: false, error: ings };
    out.ingredients = ings;
  }
  if (u.prepSteps !== undefined) {
    const steps = validatePrepSteps(u.prepSteps, 'updatedRecipe.prepSteps');
    if (typeof steps === 'string') return { ok: false, error: steps };
    out.prepSteps = steps;
  }
  if (u.nutrition !== undefined) {
    const nutrition = validateNutrition(u.nutrition, 'updatedRecipe.nutrition');
    if (typeof nutrition === 'string') return { ok: false, error: nutrition };
    out.nutrition = nutrition;
  }
  if (out.ingredients && !out.nutrition) {
    return { ok: false, error: 'Ingredients changed — include re-estimated "nutrition" in updatedRecipe.' };
  }
  const hasChange = out.name || out.description || out.method || out.ingredients || out.prepSteps || out.nutrition;
  if (!hasChange) {
    return { ok: false, error: 'updatedRecipe was sent but contains no changed fields — use null instead.' };
  }
  return { ok: true, data: { reply: parsed.reply, updatedRecipe: out } };
}

// --- 2. AI chef -----------------------------------------------------------------

export interface ChefChatReply {
  reply: string;
  recipe?: EngineNewRecipe;
}

export interface ChefContext {
  pantry: PantryStaple[];
  people: Person[];
  profiles: PersonProfile[];
}

export function buildChefPrompt(ctx: ChefContext, history: ChatTurn[], userMessage: string): string {
  const pantryLine = ctx.pantry.map((s) => `${s.name} (${s.level})`).join(', ') || '(no staples tracked)';
  const profileLines = ctx.profiles
    .map((p) => {
      const person = ctx.people.find((x) => x.id === p.personId);
      if (!person) return null;
      const bits = [
        p.likes.length && `likes ${p.likes.join(', ')}`,
        p.dislikes.length && `dislikes ${p.dislikes.join(', ')}`,
      ]
        .filter(Boolean)
        .join('; ');
      return bits ? `- ${person.name}: ${bits}` : null;
    })
    .filter(Boolean)
    .join('\n');

  return `You are the family's personal chef. The cook tells you what's in the kitchen and what they feel like eating; you talk it through briefly and then invent a complete recipe for today.

${HOUSEHOLD}

## Pantry staples on hand
${pantryLine}

## Family tastes
${profileLines || '(no strong preferences learned yet)'}

## Conversation so far
${transcript(history)}

## The cook just said
"${userMessage}"

## How to respond — STRICT JSON ONLY, no prose, no markdown fences
{
  "reply": "Talk to the cook. If you're proposing the dish, sell it in 1-2 sentences.",
  "recipe": null OR {
    "name": "...",
    "description": "...",
    "cuisineTags": ["egyptian"],
    "method": "${METHODS.join('|')}",
    "ingredients": [ {"name":"lowercase singular","quantity":500,"unit":"g","isStaple":false,"optional":false} ],
    "prepSteps": [ {"order":1,"instruction":"...","offsetMinutes":-600,"type":"advance"}, {"order":2,"instruction":"...","offsetMinutes":-30,"durationMinutes":15,"type":"cook"} ],
    "nutrition": { "caloriesPerServing": 550, "proteinPerServing": 45, "carbsPerServing": 40, "fatPerServing": 20 }
  }
}

Rules:
- If they've told you ingredients + a craving, produce the recipe NOW — don't interrogate. Ask at most one clarifying question, and only if truly necessary.
- Build around what they said they have; mark pantry staples isStaple true.
- prepSteps offsets: negative minutes before serving; "advance" for defrost/marinate/soak, "cook" within -90..0. Include a defrost step for frozen meat.
- 4 servings, clear protein source, budget Egyptian ingredients where possible.`;
}

export function parseChefReply(raw: string): { ok: true; data: ChefChatReply } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return { ok: false, error: 'The reply is not valid JSON. Return a single JSON object, no prose or fences.' };
  }
  if (!isRecord(parsed) || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { ok: false, error: 'Missing "reply" (non-empty string).' };
  }
  if (parsed.recipe === null || parsed.recipe === undefined) {
    return { ok: true, data: { reply: parsed.reply } };
  }
  const recipe = validateNewRecipe(parsed.recipe, 'recipe');
  if (typeof recipe === 'string') return { ok: false, error: recipe };
  return { ok: true, data: { reply: parsed.reply, recipe } };
}
