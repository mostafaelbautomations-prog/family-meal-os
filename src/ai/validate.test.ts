import { describe, expect, it } from 'vitest';
import { extractJsonObject, parseEngineResponse, type ValidationContext } from './validate';

const ctx: ValidationContext = {
  activeRecipeIds: ['r1', 'r2', 'r3'],
  personIds: ['p1', 'p2'],
  expectedDates: [
    '2026-07-19', // Sun
    '2026-07-20',
    '2026-07-21',
    '2026-07-22',
    '2026-07-23',
    '2026-07-24', // Fri
    '2026-07-25', // Sat
  ],
};

function meal(recipeRef: string, slot: string) {
  return { recipeRef, slot, serveTimeSuggestion: '18:00' };
}

function validResponse() {
  return {
    weekPlan: {
      days: ctx.expectedDates.map((date, i) => ({
        date,
        meals:
          i >= 5
            ? [meal('existing:r1', 'meal1'), meal('existing:r2', 'meal2')]
            : [meal('existing:r1', 'main'), meal('existing:r2', 'snack')],
      })),
    },
    newRecipes: [],
    recipeAdjustments: [],
    retirements: [],
    profileUpdates: [{ personId: 'p1', likes: ['chicken'], dislikes: [], patterns: [] }],
    rationale: 'Kept the crowd pleasers.',
  };
}

describe('extractJsonObject', () => {
  it('strips markdown fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('isolates the object from surrounding prose', () => {
    expect(extractJsonObject('Here is the plan:\n{"a":1}\nHope that helps!')).toBe('{"a":1}');
  });
});

describe('parseEngineResponse', () => {
  it('accepts a valid response', () => {
    const result = parseEngineResponse(JSON.stringify(validResponse()), ctx);
    expect(result.ok).toBe(true);
  });

  it('accepts a fenced response', () => {
    const result = parseEngineResponse('```json\n' + JSON.stringify(validResponse()) + '\n```', ctx);
    expect(result.ok).toBe(true);
  });

  it('rejects malformed JSON with a helpful message', () => {
    const result = parseEngineResponse('{"weekPlan": ', ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });

  it('rejects empty input', () => {
    expect(parseEngineResponse('   ', ctx).ok).toBe(false);
  });

  it('rejects wrong day count', () => {
    const r = validResponse();
    r.weekPlan.days.pop();
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('7');
  });

  it('rejects wrong dates', () => {
    const r = validResponse();
    r.weekPlan.days[0].date = '2026-07-18';
    expect(parseEngineResponse(JSON.stringify(r), ctx).ok).toBe(false);
  });

  it('rejects weekday slots on the weekend (Fri/Sat = meal1+meal2)', () => {
    const r = validResponse();
    r.weekPlan.days[5].meals = [meal('existing:r1', 'main'), meal('existing:r2', 'snack')];
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('meal1');
  });

  it('rejects unknown existing recipe refs', () => {
    const r = validResponse();
    r.weekPlan.days[0].meals[0] = meal('existing:nope', 'main');
    expect(parseEngineResponse(JSON.stringify(r), ctx).ok).toBe(false);
  });

  it('rejects out-of-range new: refs', () => {
    const r = validResponse();
    r.weekPlan.days[0].meals[0] = meal('new:0', 'main');
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('newRecipes');
  });

  it('rejects scheduling a recipe retired in the same plan', () => {
    const r = validResponse();
    r.retirements = [{ recipeId: 'r1', reason: 'family dislikes it' }] as never;
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('retired');
  });

  it('rejects more than 2 new recipes', () => {
    const r = validResponse();
    const newRecipe = {
      name: 'X',
      description: '',
      method: 'stove',
      ingredients: [{ name: 'chicken', quantity: 500, unit: 'g' }],
      prepSteps: [{ order: 1, instruction: 'cook', offsetMinutes: -30, type: 'cook' }],
      nutrition: { caloriesPerServing: 500, proteinPerServing: 40, carbsPerServing: 30, fatPerServing: 20 },
    };
    r.newRecipes = [newRecipe, newRecipe, newRecipe] as never;
    expect(parseEngineResponse(JSON.stringify(r), ctx).ok).toBe(false);
  });

  it('rejects new recipes missing carbs/fat macros', () => {
    const r = validResponse();
    r.newRecipes = [
      {
        name: 'X',
        description: '',
        method: 'stove',
        ingredients: [{ name: 'chicken', quantity: 500, unit: 'g' }],
        prepSteps: [{ order: 1, instruction: 'cook', offsetMinutes: -30, type: 'cook' }],
        nutrition: { caloriesPerServing: 500, proteinPerServing: 40 },
      },
    ] as never;
    r.weekPlan.days[0].meals[0] = meal('new:0', 'main');
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('carbsPerServing');
  });

  it('normalizes ingredient names and rounds all four macros on new recipes', () => {
    const r = validResponse();
    r.newRecipes = [
      {
        name: 'Koshari Bowl',
        description: 'Lentils and rice',
        method: 'stove',
        ingredients: [{ name: '  Brown Lentils ', quantity: 300, unit: 'g' }],
        prepSteps: [{ order: 1, instruction: 'simmer', offsetMinutes: -40, durationMinutes: 30, type: 'cook' }],
        nutrition: { caloriesPerServing: 512, proteinPerServing: 23, carbsPerServing: 68, fatPerServing: 12 },
      },
    ] as never;
    r.weekPlan.days[0].meals[0] = meal('new:0', 'main');
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.newRecipes[0].ingredients[0].name).toBe('brown lentil');
      expect(result.data.newRecipes[0].nutrition).toEqual({
        caloriesPerServing: 500,
        proteinPerServing: 25,
        carbsPerServing: 70,
        fatPerServing: 10,
      });
    }
  });

  it('rejects adjustments that change ingredients without re-estimated nutrition', () => {
    const r = validResponse();
    r.recipeAdjustments = [
      {
        recipeId: 'r1',
        changes: { ingredients: [{ name: 'chicken', quantity: 500, unit: 'g' }] },
        summary: 'less salt',
      },
    ] as never;
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('nutrition');
  });

  it('rejects adjustments with empty changes', () => {
    const r = validResponse();
    r.recipeAdjustments = [{ recipeId: 'r1', changes: {}, summary: 'nothing' }] as never;
    expect(parseEngineResponse(JSON.stringify(r), ctx).ok).toBe(false);
  });

  it('rejects unknown person ids in profile updates', () => {
    const r = validResponse();
    r.profileUpdates = [{ personId: 'ghost', likes: [], dislikes: [], patterns: [] }];
    expect(parseEngineResponse(JSON.stringify(r), ctx).ok).toBe(false);
  });

  it('rejects positive offsets in prep steps', () => {
    const r = validResponse();
    r.recipeAdjustments = [
      {
        recipeId: 'r1',
        changes: { prepSteps: [{ order: 1, instruction: 'x', offsetMinutes: 30, type: 'cook' }] },
        summary: 's',
      },
    ] as never;
    const result = parseEngineResponse(JSON.stringify(r), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('offsetMinutes');
  });
});
