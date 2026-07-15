// Family-feedback UI for one recipe.
// SuggestionChipRow — a pending suggestion ("Add more spice — Mom & Marwan
// think so") with Apply / No buttons. Used in the Recipes list and on the
// recipe screen.
// ReviewPanel — the full block on the recipe screen: pending chips, recent
// auto-applies, and "Analyze new reviews" (instant in Live mode, copy/paste
// fallback otherwise — hard rule #3 parity).

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  applySuggestion,
  peopleRepo,
  settingsRepo,
  suggestionsRepo,
} from '../db/repo';
import {
  assembleReview,
  importManualReview,
  newReviewCount,
  runLiveReview,
  type ReviewOutcome,
} from '../ai/review';
import { getApiKey } from '../lib/apiKey';
import { ApiKeySetup } from './ApiKeySetup';
import { IconCheck, IconCopy, IconSparkles, IconX } from './Icons';
import type { Person, RecipeSuggestion } from '../types';

export function supporterNames(s: RecipeSuggestion, people: Person[]): string {
  const names = s.supporters.map((id) => people.find((p) => p.id === id)?.name ?? 'someone');
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function SuggestionChipRow({ suggestion, people }: { suggestion: RecipeSuggestion; people: Person[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function act(action: 'apply' | 'dismiss') {
    setBusy(true);
    setError('');
    try {
      if (action === 'apply') await applySuggestion(suggestion.id);
      else await suggestionsRepo.resolve(suggestion.id, 'dismissed');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-secondary/40 bg-secondary/10 p-2.5">
      <p className="text-sm font-bold">{suggestion.summary}</p>
      <p className="text-xs text-ink-soft">{supporterNames(suggestion, people)} think so — your call.</p>
      <div className="mt-1.5 flex gap-1.5">
        <button
          onClick={() => void act('apply')}
          disabled={busy}
          className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-accent text-xs font-bold text-on-strong disabled:opacity-40"
        >
          <IconCheck size={14} strokeWidth={3} /> Agree — apply it
        </button>
        <button
          onClick={() => void act('dismiss')}
          disabled={busy}
          className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-line text-xs font-bold text-ink-soft disabled:opacity-40"
        >
          <IconX size={14} /> No, keep it
        </button>
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}

export function outcomeLine(outcome: ReviewOutcome): string {
  const bits: string[] = [];
  if (outcome.autoApplied.length > 0) {
    bits.push(`Applied automatically (everyone agreed): ${outcome.autoApplied.map((s) => s.summary).join('; ')}`);
  }
  if (outcome.queued.length > 0) {
    bits.push(`${outcome.queued.length} suggestion${outcome.queued.length > 1 ? 's' : ''} below — your call`);
  }
  if (outcome.insightsSaved > 0) {
    bits.push(`learned ${outcome.insightsSaved} new thing${outcome.insightsSaved > 1 ? 's' : ''} about the family`);
  }
  return bits.length ? bits.join(' · ') : 'No consensus changes yet — next week’s planner still sees every review.';
}

export function ReviewPanel({ recipeId }: { recipeId: string }) {
  const [bump, setBump] = useState(0);
  const people = useLiveQuery(() => peopleRepo.all());
  const settings = useLiveQuery(() => settingsRepo.get());
  const suggestions = useLiveQuery(() => suggestionsRepo.forRecipe(recipeId), [recipeId]);
  const fresh = useLiveQuery(() => newReviewCount(recipeId), [recipeId, bump]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);

  const apiKey = getApiKey();
  const live = settings?.aiMode === 'live' && !!apiKey;
  const pending = (suggestions ?? []).filter((s) => s.status === 'pending');
  const recentAuto = (suggestions ?? []).filter(
    (s) => s.status === 'auto' && s.resolvedAt && Date.now() - Date.parse(s.resolvedAt) < 14 * 86400_000
  );

  const nothingToShow = pending.length === 0 && recentAuto.length === 0 && !fresh && !manualPrompt && !result;
  if (nothingToShow) return null;

  async function analyze() {
    setError('');
    setResult('');
    if (!live) {
      const { prompt } = await assembleReview(recipeId);
      setManualPrompt(prompt);
      return;
    }
    setBusy(true);
    try {
      const res = await runLiveReview(recipeId, apiKey!);
      if (res.ok) setResult(outcomeLine(res.outcome));
      else setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed — try again.');
    } finally {
      setBusy(false);
      setBump((n) => n + 1);
    }
  }

  async function importPasted() {
    setError('');
    const activePeople = (people ?? []).filter((p) => p.active);
    const res = await importManualReview(recipeId, pasted, activePeople);
    if (!res.ok) {
      setError(`Paste didn't parse — make sure you copied Claude's entire reply. (${res.error})`);
      return;
    }
    setResult(outcomeLine(res.outcome));
    setManualPrompt(null);
    setPasted('');
    setBump((n) => n + 1);
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-3.5">
      <h2 className="flex items-center gap-1.5 font-display">
        <IconSparkles size={16} className="text-primary" /> Family feedback
      </h2>

      {recentAuto.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {recentAuto.map((s) => (
            <li key={s.id} className="flex items-start gap-1.5 text-xs font-semibold text-accent">
              <IconCheck size={14} strokeWidth={3} className="mt-0.5 shrink-0" />
              Applied automatically — {s.summary} (everyone agreed)
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {pending.map((s) => (
            <SuggestionChipRow key={s.id} suggestion={s} people={people ?? []} />
          ))}
        </div>
      )}

      {!!fresh && !manualPrompt && (
        <button
          onClick={() => void analyze()}
          disabled={busy}
          className="mt-2.5 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-secondary font-semibold text-on-strong disabled:opacity-60"
        >
          <IconSparkles size={16} className={busy ? 'animate-pulse' : ''} />
          {busy ? 'Reading the family’s reviews…' : `Check ${fresh} new review${fresh > 1 ? 's' : ''} for changes`}
        </button>
      )}

      {manualPrompt && (
        <div className="mt-2.5 rounded-xl border border-line bg-cream p-3">
          {!apiKey && <ApiKeySetup onActivated={() => setManualPrompt(null)} />}
          <p className="mt-2 mb-2 text-sm font-semibold">Free fallback: run this through claude.ai</p>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(manualPrompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
            className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-secondary font-semibold text-on-strong"
          >
            <IconCopy size={16} /> {copied ? 'Copied!' : 'Copy prompt'}
          </button>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste Claude's reply here…"
            rows={4}
            className="mt-2 w-full rounded-xl border border-line bg-surface p-2.5 font-mono text-xs"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void importPasted()}
              disabled={!pasted.trim()}
              className="min-h-11 flex-1 cursor-pointer rounded-xl bg-primary font-semibold text-on-strong disabled:opacity-40"
            >
              Import reply
            </button>
            <button
              onClick={() => {
                setManualPrompt(null);
                setPasted('');
              }}
              className="min-h-11 cursor-pointer rounded-xl border border-line px-3 font-semibold text-ink-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && <p className="mt-2 text-sm font-semibold text-accent">{result}</p>}
      {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
    </section>
  );
}
