// AI chef (/chef): tell it what's in the kitchen and what you're craving; it
// invents a recipe. From there: save it to the library and/or make it today
// (replacing a planned meal — preselected when arriving via ?meal=).

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChatSheet, type ParsedChat } from '../components/ChatSheet';
import {
  createRecipeFromSpec,
  pantryRepo,
  peopleRepo,
  profilesRepo,
  weekPlansRepo,
  type NewRecipeSpec,
} from '../db/repo';
import { buildChefPrompt, parseChefReply, type ChatTurn, type PersonNote } from '../ai/chat';
import { formatMacrosCompact } from '../lib/nutrition';
import { todayISO } from '../lib/dates';
import { IconCheck } from '../components/Icons';

interface ChefPayload {
  recipe?: NewRecipeSpec;
  personNotes?: PersonNote[];
}

export function ChefScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const targetMealId = params.get('meal');
  const activePeople = useLiveQuery(async () => (await peopleRepo.all()).filter((p) => p.active));

  const today = useLiveQuery(async () => {
    const plan = await weekPlansRepo.activePlan();
    const day = plan?.days.find((d) => d.date === todayISO());
    return { planId: plan?.id, meals: day?.meals ?? [] };
  });

  async function buildPrompt(history: ChatTurn[], userMessage: string): Promise<string> {
    const [pantry, people, profiles] = await Promise.all([
      pantryRepo.all(),
      peopleRepo.all(),
      profilesRepo.all(),
    ]);
    return buildChefPrompt(
      { pantry, people: people.filter((p) => p.active), profiles },
      history,
      userMessage
    );
  }

  function parse(raw: string): { ok: true; data: ParsedChat<ChefPayload> } | { ok: false; error: string } {
    const result = parseChefReply(raw, activePeople ?? []);
    if (!result.ok) return result;
    const { reply, recipe, personNotes } = result.data;
    const payload: ChefPayload | undefined = recipe || personNotes ? { recipe, personNotes } : undefined;
    return { ok: true, data: { reply, payload } };
  }

  return (
    <ChatSheet<ChefPayload>
      title="AI chef"
      intro="Tell me what's in your kitchen and what you're in the mood for — I'll cook up a recipe for today."
      placeholder="I have chicken thighs, rice, tomatoes… feeling something smoky"
      suggestions={[
        "I have minced beef, potatoes and peppers — I'm craving comfort food",
        'Something quick and high-protein from pantry staples only',
        "I don't want to cook much today — 20 minutes max",
      ]}
      buildPrompt={buildPrompt}
      parseReply={parse}
      onPayload={async (payload) => {
        for (const note of payload.personNotes ?? []) {
          await profilesRepo.appendNotes(note.personId, [note.note]);
        }
      }}
      renderPayload={(payload) => (
        <div className="flex flex-col gap-1.5">
          {payload.personNotes?.map((n, i) => (
            <p key={i} className="flex items-center gap-1.5 rounded-lg bg-secondary/15 px-2.5 py-1.5 text-xs font-bold text-secondary">
              <IconCheck size={14} strokeWidth={3} /> Remembered about {n.person}: {n.note}
            </p>
          ))}
          {payload.recipe && (
            <ChefRecipeCard
              spec={payload.recipe}
              planId={today?.planId}
              meals={today?.meals ?? []}
              targetMealId={targetMealId}
              onDone={() => navigate('/')}
            />
          )}
        </div>
      )}
      onClose={() => navigate(-1)}
    />
  );
}

function ChefRecipeCard({
  spec,
  planId,
  meals,
  targetMealId,
  onDone,
}: {
  spec: NewRecipeSpec;
  planId?: string;
  meals: { id: string; slot: string; serveTime: string }[];
  targetMealId: string | null;
  onDone: () => void;
}) {
  const [state, setState] = useState<'idle' | 'saved' | 'planned'>('idle');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function save(): Promise<string> {
    if (savedId) return savedId;
    const id = await createRecipeFromSpec(spec, 'Created by the AI chef from what was in the kitchen');
    setSavedId(id);
    return id;
  }

  async function makeToday(mealId: string) {
    if (!planId) return;
    const recipeId = await save();
    await weekPlansRepo.updateMeal(planId, mealId, { recipeId, status: 'planned' });
    setState('planned');
    setTimeout(onDone, 1000);
  }

  const defaultTarget = targetMealId && meals.some((m) => m.id === targetMealId) ? targetMealId : null;

  return (
    <div className="rounded-xl border border-line bg-cream p-3">
      <p className="font-display">{spec.name}</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {formatMacrosCompact({ ...spec.nutrition, confidence: 'rough' })} · {spec.method}
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        {spec.ingredients.map((i) => i.name).join(', ')}
      </p>

      {state === 'planned' ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-accent">
          <IconCheck size={14} strokeWidth={3} /> On today's plan — taking you back
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                void save().then(() => setState('saved'));
              }}
              disabled={state === 'saved'}
              className="min-h-11 flex-1 cursor-pointer rounded-lg border border-primary text-xs font-bold text-primary disabled:opacity-60"
            >
              {state === 'saved' ? 'Saved ✓' : 'Save to recipes'}
            </button>
            {meals.length > 0 && (
              <button
                onClick={() => {
                  if (defaultTarget) void makeToday(defaultTarget);
                  else setPickerOpen((o) => !o);
                }}
                className="min-h-11 flex-1 cursor-pointer rounded-lg bg-primary text-xs font-bold text-on-strong"
              >
                Make it today
              </button>
            )}
          </div>
          {pickerOpen &&
            meals.map((m) => (
              <button
                key={m.id}
                onClick={() => void makeToday(m.id)}
                className="min-h-11 cursor-pointer rounded-lg bg-mist text-xs font-bold text-ink"
              >
                Replace {m.slot} ({m.serveTime})
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
