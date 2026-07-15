import { describe, expect, it } from 'vitest';
import { classifySuggestion } from './suggestions';

const family = ['dad', 'mom', 'marwan', 'laila'];

describe('classifySuggestion', () => {
  it('auto-applies when every active member supports it', () => {
    expect(classifySuggestion(family, family)).toBe('auto');
  });

  it('queues a pending suggestion when 2 of 4 agree', () => {
    expect(classifySuggestion(['dad', 'mom'], family)).toBe('pending');
  });

  it('queues when 3 of 4 agree (not unanimous)', () => {
    expect(classifySuggestion(['dad', 'mom', 'marwan'], family)).toBe('pending');
  });

  it('skips a single voice', () => {
    expect(classifySuggestion(['marwan'], family)).toBe('skip');
  });

  it('skips with no supporters', () => {
    expect(classifySuggestion([], family)).toBe('skip');
  });

  it('ignores supporters who are not active members', () => {
    // "guest" doesn't count: only 1 valid supporter left → skip
    expect(classifySuggestion(['guest', 'dad'], family)).toBe('skip');
    // unanimity can't be reached through non-members
    expect(classifySuggestion(['guest', 'dad', 'mom', 'marwan'], family)).toBe('pending');
  });

  it('dedupes repeated supporter ids', () => {
    expect(classifySuggestion(['dad', 'dad', 'dad'], family)).toBe('skip');
  });

  it('never auto-applies for a household of one', () => {
    expect(classifySuggestion(['dad'], ['dad'])).toBe('skip');
  });

  it('auto-applies for a household of two when both agree', () => {
    expect(classifySuggestion(['dad', 'mom'], ['dad', 'mom'])).toBe('auto');
  });
});
