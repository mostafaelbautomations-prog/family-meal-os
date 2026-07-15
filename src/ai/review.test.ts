import { describe, expect, it } from 'vitest';
import { parseReviewAnalysis } from './review';
import type { Person } from '../types';

const people: Person[] = [
  { id: 'p-dad', name: 'Dad', active: true },
  { id: 'p-mom', name: 'Mom', active: true },
  { id: 'p-marwan', name: 'Marwan', active: true },
];

const nutrition = { caloriesPerServing: 512, proteinPerServing: 43, carbsPerServing: 38, fatPerServing: 22 };

describe('parseReviewAnalysis', () => {
  it('accepts an empty analysis', () => {
    const result = parseReviewAnalysis(JSON.stringify({ suggestions: [], personInsights: [] }), people);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.suggestions).toEqual([]);
      expect(result.data.personInsights).toEqual([]);
    }
  });

  it('maps supporter names to ids case-insensitively and dedupes', () => {
    const result = parseReviewAnalysis(
      JSON.stringify({
        suggestions: [
          {
            summary: 'Add more salt',
            supporters: ['dad', 'MOM', 'Dad'],
            updatedRecipe: { description: 'Now properly seasoned.', changeSummary: 'Salted the braise properly' },
          },
        ],
        personInsights: [],
      }),
      people
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.suggestions[0].supporterIds).toEqual(['p-dad', 'p-mom']);
      expect(result.data.suggestions[0].supporterNames).toEqual(['Dad', 'Mom']);
    }
  });

  it('accepts a fenced reply', () => {
    const raw =
      '```json\n' + JSON.stringify({ suggestions: [], personInsights: [{ person: 'Marwan', note: 'plate his portion before mixing in vegetables' }] }) + '\n```';
    const result = parseReviewAnalysis(raw, people);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.personInsights[0]).toMatchObject({ personId: 'p-marwan', person: 'Marwan' });
    }
  });

  it('rejects supporters who are not active members', () => {
    const result = parseReviewAnalysis(
      JSON.stringify({
        suggestions: [
          { summary: 'X', supporters: ['Grandma'], updatedRecipe: { description: 'x', changeSummary: 'x' } },
        ],
        personInsights: [],
      }),
      people
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Grandma');
  });

  it('rejects a suggestion whose patch lacks a changeSummary', () => {
    const result = parseReviewAnalysis(
      JSON.stringify({
        suggestions: [{ summary: 'More spice', supporters: ['Dad', 'Mom'], updatedRecipe: { description: 'spicy' } }],
        personInsights: [],
      }),
      people
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('changeSummary');
  });

  it('rejects ingredient changes without re-estimated nutrition', () => {
    const result = parseReviewAnalysis(
      JSON.stringify({
        suggestions: [
          {
            summary: 'More spice',
            supporters: ['Dad', 'Mom'],
            updatedRecipe: {
              ingredients: [{ name: 'chili', quantity: 1, unit: 'tsp' }],
              changeSummary: 'Added chili',
            },
          },
        ],
        personInsights: [],
      }),
      people
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('nutrition');
  });

  it('accepts a complete suggestion and rounds macros', () => {
    const result = parseReviewAnalysis(
      JSON.stringify({
        suggestions: [
          {
            summary: 'More spice',
            supporters: ['Dad', 'Mom'],
            updatedRecipe: {
              ingredients: [{ name: 'Chili Flakes', quantity: 1, unit: 'tsp' }],
              nutrition,
              changeSummary: 'Added chili flakes',
            },
          },
        ],
        personInsights: [],
      }),
      people
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.suggestions[0].patch.ingredients?.[0].name).toBe('chili flake');
      expect(result.data.suggestions[0].patch.nutrition?.caloriesPerServing).toBe(500);
    }
  });

  it('rejects prose replies with guidance', () => {
    const result = parseReviewAnalysis('The family clearly wants more salt!', people);
    expect(result.ok).toBe(false);
  });
});
