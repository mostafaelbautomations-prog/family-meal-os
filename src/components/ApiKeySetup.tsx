// Inline one-time API key setup, embedded wherever AI would otherwise fall
// back to copy/paste. Saving the key flips the app to Live (instant) mode.

import { useState } from 'react';
import { settingsRepo } from '../db/repo';
import { setApiKey } from '../lib/apiKey';
import { testConnection } from '../ai/client';
import { IconSparkles } from './Icons';

export function ApiKeySetup({ onActivated }: { onActivated: () => void }) {
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle');
  const [error, setError] = useState('');

  async function activate() {
    const key = draft.trim();
    if (!key) return;
    setState('checking');
    setError('');
    const result = await testConnection(key);
    if (!result.ok) {
      setState('error');
      setError(result.error);
      return;
    }
    setApiKey(key);
    await settingsRepo.update({ aiMode: 'live' });
    onActivated();
  }

  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/10 p-3.5">
      <p className="flex items-center gap-1.5 font-display">
        <IconSparkles size={16} className="text-primary" /> Make it instant
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        Paste your Claude API key once and every AI change happens right here, immediately — no
        copy/paste, on this screen and everywhere else in the app. Create a key at{' '}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="font-bold text-primary underline"
        >
          console.anthropic.com
        </a>{' '}
        (a recipe tweak costs about a cent).
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void activate()}
          placeholder="sk-ant-…"
          autoComplete="off"
          className="min-h-12 w-0 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-sm"
        />
        <button
          onClick={() => void activate()}
          disabled={!draft.trim() || state === 'checking'}
          className="min-h-12 shrink-0 cursor-pointer rounded-xl bg-primary px-4 font-bold text-on-strong disabled:opacity-40"
        >
          {state === 'checking' ? 'Checking…' : 'Turn on'}
        </button>
      </div>
      {state === 'error' && <p className="mt-1.5 text-sm font-semibold text-danger">{error}</p>}
      <p className="mt-1.5 text-xs text-ink-soft">
        Stored only on this phone, never in backups. Use a key with a low spend limit.
      </p>
    </div>
  );
}
