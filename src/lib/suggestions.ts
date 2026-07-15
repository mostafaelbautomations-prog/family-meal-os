// Consensus rules for review-driven recipe suggestions.
// The AI extracts "who wants what changed" from family reviews; these pure
// rules decide what happens with it:
//   - the WHOLE active family agrees   → apply automatically
//   - at least 2 people agree          → pending chip, cook decides
//   - a single voice                   → dropped (the weekly engine still
//                                        sees every raw review)

export type SuggestionVerdict = 'auto' | 'pending' | 'skip';

export function classifySuggestion(supporterIds: string[], activeMemberIds: string[]): SuggestionVerdict {
  const active = new Set(activeMemberIds);
  const supporters = new Set(supporterIds.filter((id) => active.has(id)));
  if (active.size >= 2 && supporters.size === active.size) return 'auto';
  if (supporters.size >= 2) return 'pending';
  return 'skip';
}

/** Human copy for why a change was or wasn't applied on its own. */
export function verdictLabel(verdict: SuggestionVerdict): string {
  switch (verdict) {
    case 'auto':
      return 'everyone agreed';
    case 'pending':
      return 'some of the family agrees';
    case 'skip':
      return 'only one person mentioned it';
  }
}
