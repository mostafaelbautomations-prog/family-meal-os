import { describe, expect, it } from 'vitest';
import { parseChefReply, parseRecipeChatReply } from './chat';
import type { Person } from '../types';

const nutrition = { caloriesPerServing: 512, proteinPerServing: 43, carbsPerServing: 38, fatPerServing: 22 };

const people: Person[] = [
  { id: 'p-marwan', name: 'Marwan', active: true },
  { id: 'p-mom', name: 'Mom', active: true },
];

describe('parseRecipeChatReply', () => {
  it('accepts a question answer with no changes', () => {
    const result = parseRecipeChatReply(JSON.stringify({ reply: 'Soaking softens them.', updatedRecipe: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.updatedRecipe).toBeUndefined();
  });

  it('accepts a fenced update and rounds macros', () => {
    const raw =
      '```json\n' +
      JSON.stringify({
        reply: 'Made it spicy.',
        updatedRecipe: {
          ingredients: [{ name: 'Chili Flakes', quantity: 1, unit: 'tsp' }],
          nutrition,
          changeSummary: 'Added chili flakes',
        },
      }) +
      '\n```';
    const result = parseRecipeChatReply(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.updatedRecipe?.ingredients?.[0].name).toBe('chili flake');
      expect(result.data.updatedRecipe?.nutrition?.caloriesPerServing).toBe(500);
      expect(result.data.updatedRecipe?.nutrition?.fatPerServing).toBe(20);
    }
  });

  it('rejects ingredient changes without nutrition', () => {
    const result = parseRecipeChatReply(
      JSON.stringify({
        reply: 'Done',
        updatedRecipe: {
          ingredients: [{ name: 'chili', quantity: 1, unit: 'tsp' }],
          changeSummary: 'Added chili',
        },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('nutrition');
  });

  it('rejects updates without a changeSummary', () => {
    const result = parseRecipeChatReply(
      JSON.stringify({ reply: 'Done', updatedRecipe: { method: 'airfryer' } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('changeSummary');
  });

  it('rejects an empty updatedRecipe object', () => {
    const result = parseRecipeChatReply(
      JSON.stringify({ reply: 'Done', updatedRecipe: { changeSummary: 'nothing' } })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects malformed JSON with guidance', () => {
    const result = parseRecipeChatReply('Sure! I made it spicier for you.');
    expect(result.ok).toBe(false);
  });

  it('learns durable facts about a person (case-insensitive name match)', () => {
    const result = parseRecipeChatReply(
      JSON.stringify({
        reply: "Noted — I'll always keep Marwan's plate vegetable-free.",
        updatedRecipe: null,
        personNotes: [{ person: 'marwan', note: 'plate his portion before mixing in the vegetables' }],
      }),
      people
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.personNotes).toEqual([
        { personId: 'p-marwan', person: 'Marwan', note: 'plate his portion before mixing in the vegetables' },
      ]);
    }
  });

  it('rejects personNotes for someone not in the family', () => {
    const result = parseRecipeChatReply(
      JSON.stringify({
        reply: 'Noted.',
        updatedRecipe: null,
        personNotes: [{ person: 'Grandma', note: 'no onions' }],
      }),
      people
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Grandma');
  });
});

describe('parseChefReply', () => {
  it('accepts chatting without a recipe yet', () => {
    const result = parseChefReply(JSON.stringify({ reply: 'What protein do you have?', recipe: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.recipe).toBeUndefined();
  });

  it('accepts a full recipe with macros', () => {
    const result = parseChefReply(
      JSON.stringify({
        reply: 'Smoky chicken rice it is.',
        recipe: {
          name: 'Smoky Chicken Rice',
          description: 'One-pan smoky chicken with rice',
          cuisineTags: ['egyptian'],
          method: 'stove',
          ingredients: [{ name: 'chicken thighs', quantity: 600, unit: 'g' }],
          prepSteps: [
            { order: 1, instruction: 'Defrost chicken', offsetMinutes: -600, type: 'advance' },
            { order: 2, instruction: 'Sear and simmer', offsetMinutes: -40, durationMinutes: 30, type: 'cook' },
          ],
          nutrition,
        },
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.recipe?.name).toBe('Smoky Chicken Rice');
      expect(result.data.recipe?.ingredients[0].name).toBe('chicken thigh');
    }
  });

  it('rejects a recipe missing macros', () => {
    const result = parseChefReply(
      JSON.stringify({
        reply: 'Here you go',
        recipe: {
          name: 'X',
          description: '',
          method: 'stove',
          ingredients: [{ name: 'chicken', quantity: 500, unit: 'g' }],
          prepSteps: [{ order: 1, instruction: 'cook', offsetMinutes: -30, type: 'cook' }],
          nutrition: { caloriesPerServing: 500, proteinPerServing: 40 },
        },
      })
    );
    expect(result.ok).toBe(false);
  });
});
