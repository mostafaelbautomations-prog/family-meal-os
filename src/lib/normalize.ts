// Ingredient-name normalization. Hard rule #6: applied at every write point;
// grocery dedupe depends on it.

const SINGULAR_EXCEPTIONS: Record<string, string> = {
  hummus: 'hummus',
  couscous: 'couscous',
  molasses: 'molasses',
  swiss: 'swiss',
};

export function normalizeIngredientName(raw: string): string {
  let name = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!name) return name;

  const words = name.split(' ');
  const last = words[words.length - 1];
  words[words.length - 1] = singularize(last);
  name = words.join(' ');
  return name;
}

function singularize(word: string): string {
  if (SINGULAR_EXCEPTIONS[word]) return SINGULAR_EXCEPTIONS[word];
  if (word.length <= 3) return word;
  if (word.endsWith('oes')) return word.slice(0, -2); // tomatoes → tomato
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'; // berries → berry
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2); // radishes → radish
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // onions → onion
  return word;
}
