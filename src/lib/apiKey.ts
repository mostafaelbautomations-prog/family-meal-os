// Anthropic API key storage. Hard rule #2: localStorage ONLY — never IndexedDB,
// never in exports, never logged. Masked when displayed.

const KEY = 'mealos.anthropicApiKey';

export function getApiKey(): string | null {
  return localStorage.getItem(KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY);
}

/** "sk-ant-…abcd" style masking for display. */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
