// Consensus rules for review-driven recipe suggestions.
// The AI extracts "who wants what changed" from family reviews; these pure
// rules decide what happens with it:
//   - 3 or more of the family agree       → apply automatically
//     (or everyone, in a household of 2)
//   - at least 2 people agree             → pending chip, cook decides
//   - a single voice                      → dropped (the weekly engine still
//                                           sees every raw review)

export type SuggestionVerdict = 'auto' | 'pending' | 'skip';

const AUTO_MIN_SUPPORTERS = 3;

export function classifySuggestion(supporterIds: string[], activeMemberIds: string[]): SuggestionVerdict {
  const active = new Set(activeMemberIds);
  const supporters = new Set(supporterIds.filter((id) => active.has(id)));
  const unanimousSmallHousehold = active.size === 2 && supporters.size === 2;
  if (supporters.size >= AUTO_MIN_SUPPORTERS || unanimousSmallHousehold) return 'auto';
  if (supporters.size >= 2) return 'pending';
  return 'skip';
}

/** Human copy for why a change was or wasn't applied on its own. */
export function verdictLabel(verdict: SuggestionVerdict): string {
  switch (verdict) {
    case 'auto':
      return '3+ of the family agree';
    case 'pending':
      return 'some of the family agree';
    case 'skip':
      return 'only one person mentioned it';
  }
}
