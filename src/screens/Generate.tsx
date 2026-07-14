// "Generate next week" (spec §6). Live mode calls the API; Manual mode is the
// copy/paste flow with identical prompt + validation. Either way the result is
// a draft the user reviews, can edit (swap meals), and must explicitly Accept.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Card, Screen } from '../components/Screen';
import { recipesRepo, settingsRepo } from '../db/repo';
import { getApiKey } from '../lib/apiKey';
import { formatDayLabel } from '../lib/dates';
import {
  acceptDraft,
  assembleGeneration,
  clearDraft,
  generationUnlocked,
  loadDraft,
  runLiveGeneration,
  saveDraft,
  type EngineDraft,
} from '../ai/engine';
import { parseEngineResponse } from '../ai/validate';
import { IconCheck, IconCopy, IconSparkles, IconTrash } from '../components/Icons';
import type { Recipe } from '../types';

type Stage =
  | { kind: 'idle' }
  | { kind: 'running'; status: string }
  | { kind: 'failed'; error: string; promptForManual: string }
  | { kind: 'review'; draft: EngineDraft }
  | { kind: 'accepted' };

export function GenerateScreen() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const meta = useLiveQuery(async () => ({
    unlocked: await generationUnlocked(),
    settings: await settingsRepo.get(),
    recipes: new Map((await recipesRepo.all()).map((r) => [r.id, r])),
  }));

  // Restore a pending draft on mount.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) setStage({ kind: 'review', draft });
  }, []);

  if (!meta) return <Screen title="Next week">{null}</Screen>;

  const aiMode = meta.settings?.aiMode ?? 'manual';
  const apiKey = getApiKey();

  async function startLive() {
    if (!apiKey) return;
    setStage({ kind: 'running', status: 'Gathering your week…' });
    const result = await runLiveGeneration(apiKey, (status) =>
      setStage({ kind: 'running', status })
    );
    if (result.ok) setStage({ kind: 'review', draft: result.draft });
    else setStage({ kind: 'failed', error: result.error, promptForManual: result.promptForManual });
  }

  async function accept(draft: EngineDraft) {
    await acceptDraft(draft);
    setStage({ kind: 'accepted' });
    setTimeout(() => navigate('/week'), 1200);
  }

  return (
    <Screen title="Next week" subtitle="Let the engine plan from your feedback">
      {stage.kind === 'idle' && (
        <IdleStage
          unlocked={meta.unlocked}
          aiMode={aiMode}
          hasKey={!!apiKey}
          onStartLive={() => void startLive()}
        />
      )}

      {stage.kind === 'running' && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <IconSparkles size={32} className="animate-pulse text-primary" />
          <p className="font-semibold">{stage.status}</p>
          <p className="text-xs text-ink-soft">This usually takes under a minute.</p>
        </Card>
      )}

      {stage.kind === 'failed' && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="font-semibold text-danger">{stage.error}</p>
          </Card>
          <ManualFlow prompt={stage.promptForManual} onDraft={(draft) => setStage({ kind: 'review', draft })} />
        </div>
      )}

      {stage.kind === 'review' && (
        <ReviewStage
          draft={stage.draft}
          recipes={meta.recipes}
          onAccept={() => void accept(stage.draft)}
          onDiscard={() => {
            clearDraft();
            setStage({ kind: 'idle' });
          }}
          onSwap={(dayIdx, mealIdx, recipeRef) => {
            const draft = structuredClone(stage.draft);
            draft.response.weekPlan.days[dayIdx].meals[mealIdx].recipeRef = recipeRef;
            saveDraft(draft);
            setStage({ kind: 'review', draft });
          }}
        />
      )}

      {stage.kind === 'accepted' && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white">
            <IconCheck size={28} strokeWidth={3} />
          </span>
          <p className="font-display text-lg">Next week is set!</p>
          <p className="text-sm text-ink-soft">Grocery list updated too.</p>
        </Card>
      )}
    </Screen>
  );
}

// --- Idle -----------------------------------------------------------------------

function IdleStage({
  unlocked,
  aiMode,
  hasKey,
  onStartLive,
}: {
  unlocked: boolean;
  aiMode: 'live' | 'manual';
  hasKey: boolean;
  onStartLive: () => void;
}) {
  const [manualOpen, setManualOpen] = useState(aiMode === 'manual');
  const [draftFromManual, setDraftFromManual] = useState<EngineDraft | null>(null);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (unlocked) {
      void assembleGeneration().then((a) => setPrompt(a.prompt));
    }
  }, [unlocked]);

  if (!unlocked) {
    return (
      <Card>
        <p className="font-semibold">Log at least one meal first</p>
        <p className="mt-1 text-sm text-ink-soft">
          The engine plans next week from this week's feedback. Cook something, log how it went, then
          come back.
        </p>
      </Card>
    );
  }

  if (draftFromManual) return null; // parent switches stage via onDraft

  return (
    <div className="flex flex-col gap-4">
      {aiMode === 'live' && (
        <Card>
          <p className="mb-3 text-sm text-ink-soft">
            Claude reads your feedback, retires flops, tweaks recipes and drafts next week. Nothing
            changes until you accept.
          </p>
          <button
            onClick={onStartLive}
            disabled={!hasKey}
            className="flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary font-display text-lg text-white disabled:opacity-40"
          >
            <IconSparkles size={20} /> Generate next week
          </button>
          {!hasKey && (
            <p className="mt-2 text-sm text-danger">No API key saved — add one in Settings or use Manual mode below.</p>
          )}
          <button
            onClick={() => setManualOpen((o) => !o)}
            className="mt-3 min-h-11 w-full cursor-pointer text-sm font-bold text-secondary"
          >
            {manualOpen ? 'Hide manual mode' : 'Prefer to use claude.ai for free? Manual mode'}
          </button>
        </Card>
      )}

      {(aiMode === 'manual' || manualOpen) && prompt && (
        <ManualFlow prompt={prompt} onDraft={(d) => setDraftFromManual(d)} />
      )}
    </div>
  );
}

// --- Manual mode -------------------------------------------------------------------

function ManualFlow({ prompt, onDraft }: { prompt: string; onDraft: (draft: EngineDraft) => void }) {
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function importReply() {
    setError('');
    const { ctx } = await assembleGeneration();
    const result = parseEngineResponse(pasted, ctx);
    if (!result.ok) {
      setError(`Paste didn't parse — make sure you copied Claude's entire reply. (${result.error})`);
      return;
    }
    const draft: EngineDraft = {
      response: result.data,
      expectedDates: ctx.expectedDates,
      createdAt: new Date().toISOString(),
      mode: 'manual',
    };
    saveDraft(draft);
    onDraft(draft);
  }

  return (
    <Card>
      <h2 className="mb-1 font-display text-lg">Manual mode (free)</h2>
      <ol className="mb-3 flex list-inside list-decimal flex-col gap-1 text-sm text-ink-soft">
        <li>Copy the prompt below</li>
        <li>Paste it into claude.ai and send</li>
        <li>Copy Claude's whole reply and paste it back here</li>
      </ol>
      <button
        onClick={() => void copyPrompt()}
        className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-secondary font-semibold text-white"
      >
        <IconCopy size={18} /> {copied ? 'Copied!' : 'Copy prompt'}
      </button>
      <textarea
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder="Paste Claude's reply here…"
        rows={6}
        className="mt-3 w-full rounded-xl border border-line bg-surface p-3 font-mono text-xs"
      />
      {error && <p className="mt-1 text-sm font-semibold text-danger">{error}</p>}
      <button
        onClick={() => void importReply()}
        disabled={!pasted.trim()}
        className="mt-2 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-white disabled:opacity-40"
      >
        Import plan
      </button>
    </Card>
  );
}

// --- Review & accept ------------------------------------------------------------------

function ReviewStage({
  draft,
  recipes,
  onAccept,
  onDiscard,
  onSwap,
}: {
  draft: EngineDraft;
  recipes: Map<string, Recipe>;
  onAccept: () => void;
  onDiscard: () => void;
  onSwap: (dayIdx: number, mealIdx: number, recipeRef: string) => void;
}) {
  const { response } = draft;
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  const refName = (ref: string): string => {
    const existing = ref.match(/^existing:(.+)$/);
    if (existing) return recipes.get(existing[1])?.name ?? 'Unknown recipe';
    return response.newRecipes[Number(ref.slice(4))]?.name ?? 'New recipe';
  };

  // Swap options: active recipes (not retired in this draft) + this draft's new recipes.
  const retiredIds = useMemo(() => new Set(response.retirements.map((r) => r.recipeId)), [response]);
  const swapOptions = useMemo(() => {
    const opts: { ref: string; name: string }[] = [];
    for (const [id, r] of recipes) {
      if (r.status === 'active' && !retiredIds.has(id)) opts.push({ ref: `existing:${id}`, name: r.name });
    }
    response.newRecipes.forEach((nr, i) => opts.push({ ref: `new:${i}`, name: `${nr.name} (new)` }));
    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [recipes, response, retiredIds]);

  async function handleAccept() {
    setAccepting(true);
    setError('');
    try {
      onAccept();
    } catch {
      setError("Couldn't save the plan — nothing was changed. Try again.");
      setAccepting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-primary/30 bg-primary/[0.03]">
        <h2 className="mb-1 font-display text-lg">What the engine did</h2>
        <p className="text-sm whitespace-pre-wrap">{response.rationale}</p>
      </Card>

      {(response.retirements.length > 0 || response.recipeAdjustments.length > 0 || response.newRecipes.length > 0) && (
        <Card>
          <h2 className="mb-2 font-display text-lg">Changes</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {response.retirements.map((r) => (
              <li key={r.recipeId}>
                <span className="font-bold text-danger">Retired</span> {recipes.get(r.recipeId)?.name}:{' '}
                <span className="text-ink-soft">{r.reason}</span>
              </li>
            ))}
            {response.recipeAdjustments.map((a, i) => (
              <li key={i}>
                <span className="font-bold text-secondary">Adjusted</span> {recipes.get(a.recipeId)?.name}:{' '}
                <span className="text-ink-soft">{a.summary}</span>
              </li>
            ))}
            {response.newRecipes.map((nr, i) => (
              <li key={i}>
                <span className="font-bold text-accent">New</span> {nr.name}:{' '}
                <span className="text-ink-soft">{nr.description}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div>
        <h2 className="mb-2 font-display text-lg">The plan (tap a meal to swap)</h2>
        <div className="flex flex-col gap-2">
          {response.weekPlan.days.map((day, dayIdx) => (
            <Card key={day.date}>
              <p className="mb-1.5 text-xs font-bold tracking-wide text-secondary uppercase">
                {formatDayLabel(day.date)}
              </p>
              <div className="flex flex-col gap-1.5">
                {day.meals.map((meal, mealIdx) => (
                  <label key={mealIdx} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs font-bold text-ink-soft uppercase">{meal.slot}</span>
                    <select
                      value={meal.recipeRef}
                      onChange={(e) => onSwap(dayIdx, mealIdx, e.target.value)}
                      className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-2 font-semibold"
                    >
                      <option value={meal.recipeRef}>{refName(meal.recipeRef)}</option>
                      {swapOptions
                        .filter((o) => o.ref !== meal.recipeRef)
                        .map((o) => (
                          <option key={o.ref} value={o.ref}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      <button
        onClick={() => void handleAccept()}
        disabled={accepting}
        className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-accent font-display text-lg text-white disabled:opacity-50"
      >
        <IconCheck size={20} /> {accepting ? 'Saving…' : 'Accept plan'}
      </button>
      <button
        onClick={onDiscard}
        className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl font-semibold text-danger"
      >
        <IconTrash size={16} /> Discard draft
      </button>
    </div>
  );
}
