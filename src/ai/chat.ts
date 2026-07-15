// Chat contracts for the two conversational features:
//  1. Recipe tweaker — live-alter an existing recipe from the recipe screen
//  2. AI chef — "here's what I have / what I'm craving" → a brand-new recipe
// Both work identically in Live (API) and Manual (copy/paste) modes: the
// prompt carries the full conversation, so a single-turn exchange in claude.ai
// produces the same result as the API call (hard rule #3's spirit).
// Both can also LEARN: when the cook states a lasting fact about a family
// member, the reply carries it back as a personNote saved to that profile.

import type { PantryStaple, Person, PersonProfile, Recipe, RecipePatch } from '../types';
import {
  extractJsonObject,
  isRecord,
  METHODS,
  validateIngredients,
  validateNewRecipe,
  validateNutrition,
  validatePrepSteps,
  type EngineNewRecipe,
} from './validate';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** A durable fact about one family member, learned mid-conversation. */
export interface PersonNote {
  personId: string;
  person: string;
  note: string;
}

function transcript(history: ChatTurn[]): string {
  if (history.length === 0) return '(none yet — this is the first message)';
  return history
    .slice(-12)
    .map((t) => (t.role === 'user' ? `Cook: ${t.text}` : `You replied: ${t.text}`))
    .join('\n');
}

const HOUSEHOLD = `Household facts: Egyptian family of 4, budget-conscious, airfryer available, prefers oven/grill/stove/airfryer over deep frying. Every meal needs a clear protein source. Nutrition values are rough per-serving estimates with all four fields: caloriesPerServing, proteinPerServing, carbsPerServing, fatPerServing.`;

export interface FamilyContext {
  people: Person[]; // active members
  profiles: PersonProfile[];
}

export function familyBlock({ people, profiles }: FamilyContext): string {
  const lines = people.map((person) => {
    const p = profiles.find((x) => x.personId === person.id);
    const bits = [
      p?.likes.length ? `likes ${p.likes.join(', ')}` : null,
      p?.dislikes.length ? `dislikes ${p.dislikes.join(', ')}` : null,
      p?.notes?.length ? `KITCHEN NOTES — always follow: ${p.notes.join(' | ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    return `- ${person.name}${bits ? `: ${bits}` : ''}`;
  });
  return lines.join('\n') || '(no family members listed)';
}

const PERSON_NOTES_CONTRACT = `"personNotes": [] OR [ {"person": "<exact name from the family list>", "note": "the lasting rule or fact, phrased as an instruction"} ]`;

const PERSON_NOTES_RULE = `- If the cook states a LASTING fact about a family member ("Marwan doesn't like vegetables — make him a separate plate before mixing them in"), record it in "personNotes" so it's remembered forever, AND apply it now if it affects this dish. One-off requests ("less salt today") are NOT personNotes. Otherwise send [].`;

// --- Shared patch validation ------------------------------------------------------

/**
 * Validate a partial-recipe update (chat tweak or review suggestion).
 * Returns the cleaned patch, or an error string for the retry loop.
 */
export function validateRecipePatch(u: unknown, path: string): RecipePatch | string {
  if (!isRecord(u)) return `"${path}" must be an object.`;
  if (typeof u.changeSummary !== 'string' || !u.changeSummary.trim()) {
    return `"${path}.changeSummary" (one line for the changelog) is required.`;
  }

  const out: RecipePatch = { changeSummary: u.changeSummary.trim() };
  if (u.name !== undefined) {
    if (typeof u.name !== 'string' || !u.name.trim()) return `"${path}.name" must be a non-empty string.`;
    out.name = u.name.trim();
  }
  if (u.description !== undefined) {
    if (typeof u.description !== 'string') return `"${path}.description" must be a string.`;
    out.description = u.description;
  }
  if (u.method !== undefined) {
    if (typeof u.method !== 'string' || !METHODS.includes(u.method as Recipe['method'])) {
      return `"${path}.method" must be one of ${METHODS.join('/')}.`;
    }
    out.method = u.method as Recipe['method'];
  }
  if (u.ingredients !== undefined) {
    const ings = validateIngredients(u.ingredients, `${path}.ingredients`);
    if (typeof ings === 'string') return ings;
    out.ingredients = ings;
  }
  if (u.prepSteps !== undefined) {
    const steps = validatePrepSteps(u.prepSteps, `${path}.prepSteps`);
    if (typeof steps === 'string') return steps;
    out.prepSteps = steps;
  }
  if (u.nutrition !== undefined) {
    const nutrition = validateNutrition(u.nutrition, `${path}.nutrition`);
    if (typeof nutrition === 'string') return nutrition;
    out.nutrition = nutrition;
  }
  if (out.ingredients && !out.nutrition) {
    return `Ingredients changed — include re-estimated "nutrition" in ${path}.`;
  }
  const hasChange =
    out.name || out.description || out.method || out.ingredients || out.prepSteps || out.nutrition;
  if (!hasChange) {
    return `${path} was sent but contains no changed fields — use null instead.`;
  }
  return out;
}

/** Validate the optional personNotes array against the real family list. */
export function validatePersonNotes(v: unknown, people: Person[]): PersonNote[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return '"personNotes" must be an array (or []).';
  const out: PersonNote[] = [];
  for (const item of v) {
    if (!isRecord(item)) return 'Each personNotes entry needs "person" and "note" strings.';
    const { person: personRaw, note: noteRaw } = item;
    if (typeof personRaw !== 'string' || typeof noteRaw !== 'string') {
      return 'Each personNotes entry needs "person" and "note" strings.';
    }
    const person = people.find((p) => p.name.trim().toLowerCase() === personRaw.trim().toLowerCase());
    if (!person) {
      return `personNotes: "${personRaw}" is not in the family list (${people.map((p) => p.name).join(', ')}). Use an exact name.`;
    }
    const note = noteRaw.trim();
    if (!note) return 'personNotes: "note" must not be empty.';
    out.push({ personId: person.id, person: person.name, note: note.slice(0, 300) });
  }
  return out;
}

// --- 1. Recipe tweaker ---------------------------------------------------------

export interface RecipeChatReply {
  reply: string;
  updatedRecipe?: RecipePatch;
  personNotes?: PersonNote[];
}

export function buildRecipeChatPrompt(
  recipe: Recipe,
  family: FamilyContext,
  history: ChatTurn[],
  userMessage: string
): string {
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

## The family
${familyBlock(family)}

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
  },
  ${PERSON_NOTES_CONTRACT}
}

Rules:
- Pure question ("why soak the lentils?") → "updatedRecipe": null.
- Any change → include ONLY the fields that change, but ingredients/prepSteps must be COMPLETE arrays when included, and whenever ingredients change include re-estimated "nutrition".
- Changing doneness/texture (e.g. "crispy and charred, not juicy") usually means rewriting prepSteps and maybe method — do it.
- prepSteps offsets: negative minutes before serving; "advance" for defrost/marinate/soak hours ahead, "cook" within -90..0.
- Honour every KITCHEN NOTE above in the prepSteps where relevant (e.g. plate a portion separately before an ingredient goes in).
${PERSON_NOTES_RULE}
- Keep it 4 servings, budget-friendly, protein intact unless asked otherwise.`;
}

export function parseRecipeChatReply(
  raw: string,
  people: Person[] = []
): { ok: true; data: RecipeChatReply } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return { ok: false, error: 'The reply is not valid JSON. Return a single JSON object, no prose or fences.' };
  }
  if (!isRecord(parsed) || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { ok: false, error: 'Missing "reply" (non-empty string).' };
  }

  const personNotes = validatePersonNotes(parsed.personNotes, people);
  if (typeof personNotes === 'string') return { ok: false, error: personNotes };

  const data: RecipeChatReply = { reply: parsed.reply };
  if (personNotes.length > 0) data.personNotes = personNotes;

  if (parsed.updatedRecipe === null || parsed.updatedRecipe === undefined) {
    return { ok: true, data };
  }
  const patch = validateRecipePatch(parsed.updatedRecipe, 'updatedRecipe');
  if (typeof patch === 'string') return { ok: false, error: patch };
  data.updatedRecipe = patch;
  return { ok: true, data };
}

// --- 2. AI chef -----------------------------------------------------------------

export interface ChefChatReply {
  reply: string;
  recipe?: EngineNewRecipe;
  personNotes?: PersonNote[];
}

export interface ChefContext {
  pantry: PantryStaple[];
  people: Person[];
  profiles: PersonProfile[];
}

export function buildChefPrompt(ctx: ChefContext, history: ChatTurn[], userMessage: string): string {
  const pantryLine = ctx.pantry.map((s) => `${s.name} (${s.level})`).join(', ') || '(no staples tracked)';

  return `You are the family's personal chef. The cook tells you what's in the kitchen and what they feel like eating; you talk it through briefly and then invent a complete recipe for today.

${HOUSEHOLD}

## Pantry staples on hand
${pantryLine}

## The family
${familyBlock({ people: ctx.people, profiles: ctx.profiles })}

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
  },
  ${PERSON_NOTES_CONTRACT}
}

Rules:
- If they've told you ingredients + a craving, produce the recipe NOW — don't interrogate. Ask at most one clarifying question, and only if truly necessary.
- Build around what they said they have; mark pantry staples isStaple true.
- prepSteps offsets: negative minutes before serving; "advance" for defrost/marinate/soak, "cook" within -90..0. Include a defrost step for frozen meat.
- Honour every KITCHEN NOTE above in the prepSteps where relevant (e.g. plate a portion separately before an ingredient goes in).
${PERSON_NOTES_RULE}
- 4 servings, clear protein source, budget Egyptian ingredients where possible.`;
}

export function parseChefReply(
  raw: string,
  people: Person[] = []
): { ok: true; data: ChefChatReply } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return { ok: false, error: 'The reply is not valid JSON. Return a single JSON object, no prose or fences.' };
  }
  if (!isRecord(parsed) || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return { ok: false, error: 'Missing "reply" (non-empty string).' };
  }

  const personNotes = validatePersonNotes(parsed.personNotes, people);
  if (typeof personNotes === 'string') return { ok: false, error: personNotes };

  const data: ChefChatReply = { reply: parsed.reply };
  if (personNotes.length > 0) data.personNotes = personNotes;

  if (parsed.recipe === null || parsed.recipe === undefined) {
    return { ok: true, data };
  }
  const recipe = validateNewRecipe(parsed.recipe, 'recipe');
  if (typeof recipe === 'string') return { ok: false, error: recipe };
  data.recipe = recipe;
  return { ok: true, data };
}
