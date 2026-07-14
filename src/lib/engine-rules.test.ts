import { describe, expect, it } from 'vitest';
import type { AteAmount, Enjoyment, MealFeedback, PersonFeedback } from '../types';
import {
  averageEnjoyment,
  isRetirementCandidate,
  lowIntakeCount,
  retirementCandidateIds,
} from './engine-rules';

function entry(enjoyment: Enjoyment, ateAmount: AteAmount = 'most'): PersonFeedback {
  return { personId: crypto.randomUUID(), enjoyment, ateAmount };
}

function feedback(recipeId: string, date: string, entries: PersonFeedback[]): MealFeedback {
  return {
    id: crypto.randomUUID(),
    plannedMealId: crypto.randomUUID(),
    recipeId,
    date,
    entries,
    cookNotes: '',
    overallNote: '',
  };
}

describe('averageEnjoyment', () => {
  it('averages entries', () => {
    expect(averageEnjoyment(feedback('r', '2026-07-12', [entry(1), entry(3)]))).toBe(2);
  });
  it('is 0 for no entries', () => {
    expect(averageEnjoyment(feedback('r', '2026-07-12', []))).toBe(0);
  });
});

describe('isRetirementCandidate', () => {
  it('flags avg enjoyment ≤ 2', () => {
    expect(isRetirementCandidate(feedback('r', 'd', [entry(2), entry(2), entry(2), entry(2)]))).toBe(true);
    expect(isRetirementCandidate(feedback('r', 'd', [entry(2), entry(3), entry(3), entry(3)]))).toBe(false);
  });

  it('flags ≥2 people eating little or less', () => {
    const fb = feedback('r', 'd', [
      entry(4, 'little'),
      entry(5, 'none'),
      entry(5, 'all'),
      entry(4, 'most'),
    ]);
    expect(lowIntakeCount(fb)).toBe(2);
    expect(isRetirementCandidate(fb)).toBe(true);
  });

  it('does not flag one low eater with good enjoyment', () => {
    const fb = feedback('r', 'd', [entry(4, 'little'), entry(5), entry(4), entry(4)]);
    expect(isRetirementCandidate(fb)).toBe(false);
  });
});

describe('retirementCandidateIds', () => {
  it('uses only the LATEST feedback per recipe', () => {
    const bad = feedback('r1', '2026-07-01', [entry(1), entry(1)]);
    const improved = feedback('r1', '2026-07-08', [entry(4), entry(5)]);
    expect(retirementCandidateIds([bad, improved])).toEqual([]);
    expect(retirementCandidateIds([improved, bad])).toEqual([]); // order-independent
  });

  it('collects candidates across recipes', () => {
    const r1 = feedback('r1', '2026-07-08', [entry(1), entry(2)]);
    const r2 = feedback('r2', '2026-07-08', [entry(5), entry(5)]);
    expect(retirementCandidateIds([r1, r2])).toEqual(['r1']);
  });
});
