// Recipe detail: macros, ingredients, steps, version history — plus the live
// recipe alterer ("Tweak with AI"): chat that instantly applies changes as a
// new version with a changelog entry.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Screen } from '../components/Screen';
import { ChatSheet, type ParsedChat } from '../components/ChatSheet';
import { ReviewPanel } from '../components/ReviewPanel';
import { applyRecipeChatUpdate, peopleRepo, profilesRepo, recipesRepo } from '../db/repo';
import {
  buildRecipeChatPrompt,
  parseRecipeChatReply,
  type ChatTurn,
  type PersonNote,
  type RecipeChatReply,
} from '../ai/chat';
import { formatMacros } from '../lib/nutrition';
import { IconCheck, IconChevronLeft, IconSparkles } from '../components/Icons';

interface TweakPayload {
  update?: RecipeChatReply['updatedRecipe'];
  personNotes?: PersonNote[];
}

export function RecipeDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);
  const recipe = useLiveQuery(() => (id ? recipesRepo.byId(id) : undefined), [id]);
  const activePeople = useLiveQuery(async () => (await peopleRepo.all()).filter((p) => p.active));

  if (!recipe) {
    return (
      <Screen title="Recipe">
        <Card><p className="text-ink-soft">Recipe not found.</p></Card>
      </Screen>
    );
  }

  async function buildPrompt(history: ChatTurn[], userMessage: string): Promise<string> {
    const [fresh, people, profiles] = await Promise.all([
      recipesRepo.byId(id!),
      peopleRepo.all(),
      profilesRepo.all(),
    ]);
    if (!fresh) throw new Error('Recipe disappeared');
    return buildRecipeChatPrompt(fresh, { people: people.filter((p) => p.active), profiles }, history, userMessage);
  }

  function parse(raw: string): { ok: true; data: ParsedChat<TweakPayload> } | { ok: false; error: string } {
    const result = parseRecipeChatReply(raw, activePeople ?? []);
    if (!result.ok) return result;
    const { reply, updatedRecipe, personNotes } = result.data;
    const payload: TweakPayload | undefined =
      updatedRecipe || personNotes ? { update: updatedRecipe, personNotes } : undefined;
    return { ok: true, data: { reply, payload } };
  }

  return (
    <main className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <button
        onClick={() => navigate(-1)}
        className="mb-3 flex min-h-11 cursor-pointer items-center gap-1 font-semibold text-primary"
      >
        <IconChevronLeft size={20} /> Back
      </button>
      <h1 className="font-display text-2xl">{recipe.name}</h1>
      <p className="mt-1 text-sm text-ink-soft">{recipe.description}</p>
      {recipe.status === 'retired' && (
        <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          Retired{recipe.retiredReason ? `: ${recipe.retiredReason}` : ''}
        </p>
      )}
      <p className="mt-2 text-sm font-semibold text-secondary">
        {formatMacros(recipe.nutrition)} <span className="font-normal text-ink-soft">/ serving (rough)</span>
      </p>

      <button
        onClick={() => setChatOpen(true)}
        className="mt-4 flex min-h-13 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-display text-on-strong"
      >
        <IconSparkles size={20} /> Tweak with AI
      </button>

      <ReviewPanel recipeId={recipe.id} />

      <h2 className="mt-5 mb-2 font-display text-lg">Ingredients</h2>
      <Card>
        <ul className="flex flex-col divide-y divide-line">
          {recipe.ingredients.map((ing) => (
            <li key={ing.name} className="flex items-baseline justify-between py-2.5">
              <span className="capitalize">
                {ing.name}
                {ing.optional && <span className="text-xs text-ink-soft"> (optional)</span>}
              </span>
              <span className="text-sm text-ink-soft">
                {ing.quantity} {ing.unit}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <h2 className="mt-5 mb-2 font-display text-lg">Steps</h2>
      <Card>
        <ol className="flex flex-col gap-3">
          {recipe.prepSteps
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((step) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mist text-sm font-bold text-secondary">
                  {step.order}
                </span>
                <div>
                  <p>{step.instruction}</p>
                  <p className="text-xs text-ink-soft">
                    {step.type === 'advance' ? 'Ahead of time · ' : ''}
                    {formatOffset(step.offsetMinutes)} before serving
                    {step.durationMinutes ? ` · ${step.durationMinutes} min` : ''}
                  </p>
                </div>
              </li>
            ))}
        </ol>
      </Card>

      <h2 className="mt-5 mb-2 font-display text-lg">History</h2>
      <Card>
        <p className="text-sm font-semibold">Version {recipe.version}</p>
        {recipe.changelog.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">No adjustments yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 border-l-2 border-line pl-3">
            {recipe.changelog
              .slice()
              .reverse()
              .map((change, i) => (
                <li key={i}>
                  <p className="text-sm">{change.summary}</p>
                  <p className="text-xs text-ink-soft">
                    {change.date.slice(0, 10)} · {change.source === 'ai' ? 'engine' : 'manual'}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {chatOpen && (
        <ChatSheet<TweakPayload>
          title={`Tweak: ${recipe.name}`}
          intro="Tell me how you want this dish different — spicier, crispier, richer, lighter, a different tool — or just ask a question. Changes apply instantly and land in the version history."
          placeholder="Make it spicier, I have…"
          suggestions={[
            'Make this spicier — I have chili flakes and fresh garlic',
            'I want it crispy and charred, not soft and juicy',
            'This seems too light — make it more calorie-dense but still healthy',
            'Can I make this in the airfryer instead?',
          ]}
          buildPrompt={buildPrompt}
          parseReply={parse}
          onPayload={async (payload) => {
            if (payload.update) await applyRecipeChatUpdate(recipe.id, payload.update);
            for (const note of payload.personNotes ?? []) {
              await profilesRepo.appendNotes(note.personId, [note.note]);
            }
          }}
          renderPayload={(payload) => (
            <div className="flex flex-col gap-1">
              {payload.update && (
                <p className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-bold text-accent">
                  <IconCheck size={14} strokeWidth={3} /> Recipe updated — {payload.update.changeSummary}
                </p>
              )}
              {payload.personNotes?.map((n, i) => (
                <p key={i} className="flex items-center gap-1.5 rounded-lg bg-secondary/15 px-2.5 py-1.5 text-xs font-bold text-secondary">
                  <IconCheck size={14} strokeWidth={3} /> Remembered about {n.person}: {n.note}
                </p>
              ))}
            </div>
          )}
          onClose={() => setChatOpen(false)}
        />
      )}
    </main>
  );
}

function formatOffset(offsetMinutes: number): string {
  const mins = Math.abs(offsetMinutes);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
