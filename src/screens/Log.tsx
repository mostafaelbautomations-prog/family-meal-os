// Feedback logging: meals awaiting feedback on top, then history grouped by
// week with a per-person filter. Saving feedback marks the meal cooked.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, Screen } from '../components/Screen';
import { db } from '../db/db';
import { feedbackRepo, peopleRepo, recipesRepo, weekPlansRepo } from '../db/repo';
import { formatDayLabel, timeOnDate, todayISO, weekStartISO } from '../lib/dates';
import { parseISO } from 'date-fns';
import type {
  AteAmount,
  Enjoyment,
  MealFeedback,
  Person,
  PersonFeedback,
  Recipe,
} from '../types';
import { IconCheck, IconChevronLeft, IconChevronRight } from '../components/Icons';

const ATE_OPTIONS: { value: AteAmount; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'little', label: 'Little' },
  { value: 'half', label: 'Half' },
  { value: 'most', label: 'Most' },
  { value: 'all', label: 'All' },
  { value: 'seconds', label: '2nds' },
];

// Spec §4.3 calls for an emoji enjoyment scale.
const ENJOY_OPTIONS: { value: Enjoyment; emoji: string; label: string }[] = [
  { value: 1, emoji: '😖', label: 'Hated it' },
  { value: 2, emoji: '😕', label: 'Not great' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Liked it' },
  { value: 5, emoji: '😍', label: 'Loved it' },
];

interface PendingMeal {
  planId: string;
  mealId: string;
  date: string;
  recipe: Recipe;
}

export function LogScreen() {
  const [selected, setSelected] = useState<PendingMeal | null>(null);

  const data = useLiveQuery(async () => {
    const [plan, people, allFeedback, recipes] = await Promise.all([
      weekPlansRepo.activePlan(),
      peopleRepo.all(),
      feedbackRepo.all(),
      recipesRepo.all(),
    ]);
    const recipeMap = new Map(recipes.map((r) => [r.id, r]));
    const loggedIds = new Set(allFeedback.map((f) => f.plannedMealId));

    // Awaiting feedback: serve time passed, not skipped, not logged yet.
    const now = new Date();
    const pending: PendingMeal[] = [];
    if (plan) {
      for (const day of plan.days) {
        if (day.date > todayISO()) continue;
        for (const meal of day.meals) {
          if (meal.status === 'skipped' || loggedIds.has(meal.id)) continue;
          if (timeOnDate(day.date, meal.serveTime).getTime() > now.getTime()) continue;
          const recipe = recipeMap.get(meal.recipeId);
          if (recipe) pending.push({ planId: plan.id, mealId: meal.id, date: day.date, recipe });
        }
      }
    }
    return { people: people.filter((p) => p.active), pending, allFeedback, recipeMap };
  });

  if (!data) return <Screen title="Log">{null}</Screen>;

  if (selected) {
    return (
      <FeedbackForm
        pending={selected}
        people={data.people}
        onClose={() => setSelected(null)}
      />
    );
  }

  return (
    <Screen title="Log" subtitle="Meal feedback">
      <section className="mb-5">
        <h2 className="mb-2 font-display text-lg">Awaiting feedback</h2>
        {data.pending.length === 0 ? (
          <Card>
            <p className="text-ink-soft">All caught up. Meals show up here after their serve time.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {data.pending.map((p) => (
              <button
                key={p.mealId}
                onClick={() => setSelected(p)}
                className="cursor-pointer text-left"
              >
                <Card className="flex items-center justify-between">
                  <div>
                    <p className="font-display">{p.recipe.name}</p>
                    <p className="text-xs text-ink-soft">{formatDayLabel(p.date)}</p>
                  </div>
                  <IconChevronRight className="text-ink-soft" />
                </Card>
              </button>
            ))}
          </div>
        )}
      </section>

      <HistorySection people={data.people} feedback={data.allFeedback} recipeMap={data.recipeMap} />
    </Screen>
  );
}

// --- Feedback form ---------------------------------------------------------------

function FeedbackForm({
  pending,
  people,
  onClose,
}: {
  pending: PendingMeal;
  people: Person[];
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Record<string, Partial<PersonFeedback>>>(
    Object.fromEntries(people.map((p) => [p.id, {}]))
  );
  const [overallNote, setOverallNote] = useState('');
  const [cookNotes, setCookNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const complete = people.every((p) => entries[p.id]?.ateAmount && entries[p.id]?.enjoyment);

  function patch(personId: string, p: Partial<PersonFeedback>) {
    setEntries((e) => ({ ...e, [personId]: { ...e[personId], ...p } }));
  }

  async function save() {
    if (!complete) return;
    setSaving(true);
    setError('');
    try {
      const fb: MealFeedback = {
        id: crypto.randomUUID(),
        plannedMealId: pending.mealId,
        recipeId: pending.recipe.id,
        date: pending.date,
        entries: people.map((p) => ({
          personId: p.id,
          ateAmount: entries[p.id].ateAmount as AteAmount,
          enjoyment: entries[p.id].enjoyment as Enjoyment,
          note: entries[p.id].note?.trim() || undefined,
        })),
        cookNotes: cookNotes.trim(),
        overallNote: overallNote.trim(),
      };
      await db.transaction('rw', db.feedback, db.weekPlans, async () => {
        await feedbackRepo.add(fb);
        await weekPlansRepo.updateMeal(pending.planId, pending.mealId, { status: 'cooked' });
      });
      onClose();
    } catch {
      setError("Couldn't save feedback — try again.");
      setSaving(false);
    }
  }

  return (
    <main className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <button
        onClick={onClose}
        className="mb-3 flex min-h-11 cursor-pointer items-center gap-1 font-semibold text-primary"
      >
        <IconChevronLeft size={20} /> Back
      </button>
      <h1 className="font-display text-2xl">{pending.recipe.name}</h1>
      <p className="mb-4 text-sm text-ink-soft">{formatDayLabel(pending.date)}</p>

      <div className="flex flex-col gap-4">
        {people.map((person) => {
          const e = entries[person.id];
          return (
            <Card key={person.id}>
              <h2 className="mb-2 font-display text-lg">{person.name}</h2>

              <p className="mb-1 text-xs font-bold tracking-wide text-ink-soft uppercase">How much?</p>
              <div className="mb-3 grid grid-cols-6 gap-1" role="radiogroup" aria-label={`${person.name} ate`}>
                {ATE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={e.ateAmount === opt.value}
                    onClick={() => patch(person.id, { ateAmount: opt.value })}
                    className={`min-h-11 cursor-pointer rounded-lg text-xs font-bold ${
                      e.ateAmount === opt.value ? 'bg-primary text-white' : 'bg-mist text-ink-soft'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <p className="mb-1 text-xs font-bold tracking-wide text-ink-soft uppercase">Enjoyed it?</p>
              <div className="mb-3 grid grid-cols-5 gap-1" role="radiogroup" aria-label={`${person.name} enjoyment`}>
                {ENJOY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={e.enjoyment === opt.value}
                    aria-label={opt.label}
                    onClick={() => patch(person.id, { enjoyment: opt.value })}
                    className={`min-h-12 cursor-pointer rounded-lg text-2xl ${
                      e.enjoyment === opt.value ? 'bg-primary/10 ring-2 ring-primary' : 'bg-mist'
                    }`}
                  >
                    {opt.emoji}
                  </button>
                ))}
              </div>

              <input
                value={e.note ?? ''}
                onChange={(ev) => patch(person.id, { note: ev.target.value })}
                placeholder={`Note about ${person.name} (optional)`}
                className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
              />
            </Card>
          );
        })}

        <Card>
          <h2 className="mb-2 font-display text-lg">The meal itself</h2>
          <label className="mb-1 block text-xs font-bold tracking-wide text-ink-soft uppercase">
            Overall note (feeds next week's plan)
          </label>
          <input
            value={overallNote}
            onChange={(e) => setOverallNote(e.target.value)}
            placeholder='e.g. "too salty", "everyone wanted more sauce"'
            className="mb-3 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
          />
          <label className="mb-1 block text-xs font-bold tracking-wide text-ink-soft uppercase">
            Cook notes (for you)
          </label>
          <input
            value={cookNotes}
            onChange={(e) => setCookNotes(e.target.value)}
            placeholder='e.g. "ran long, sauce reduced too much"'
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
          />
        </Card>

        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        <button
          onClick={() => void save()}
          disabled={!complete || saving}
          className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary font-display text-lg text-white disabled:opacity-40"
        >
          <IconCheck size={20} /> {saving ? 'Saving…' : 'Save feedback'}
        </button>
        {!complete && (
          <p className="-mt-2 text-center text-xs text-ink-soft">
            Pick "how much" and a face for everyone to save.
          </p>
        )}
      </div>
    </main>
  );
}

// --- History -----------------------------------------------------------------------

function HistorySection({
  people,
  feedback,
  recipeMap,
}: {
  people: Person[];
  feedback: MealFeedback[];
  recipeMap: Map<string, Recipe>;
}) {
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [dislikedOnly, setDislikedOnly] = useState(false);

  const grouped = useMemo(() => {
    let rows = feedback.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (personFilter) {
      rows = rows.filter((f) => f.entries.some((e) => e.personId === personFilter));
      if (dislikedOnly) {
        rows = rows.filter((f) =>
          f.entries.some((e) => e.personId === personFilter && e.enjoyment <= 2)
        );
      }
    }
    const byWeek = new Map<string, MealFeedback[]>();
    for (const f of rows) {
      const week = weekStartISO(parseISO(f.date));
      byWeek.set(week, [...(byWeek.get(week) ?? []), f]);
    }
    return [...byWeek.entries()];
  }, [feedback, personFilter, dislikedOnly]);

  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? '?';

  return (
    <section>
      <h2 className="mb-2 font-display text-lg">History</h2>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={personFilter === null} onClick={() => setPersonFilter(null)}>
          Everyone
        </FilterChip>
        {people.map((p) => (
          <FilterChip key={p.id} active={personFilter === p.id} onClick={() => setPersonFilter(p.id)}>
            {p.name}
          </FilterChip>
        ))}
        {personFilter && (
          <FilterChip active={dislikedOnly} onClick={() => setDislikedOnly((d) => !d)}>
            Disliked only
          </FilterChip>
        )}
      </div>

      {grouped.length === 0 && (
        <Card>
          <p className="text-ink-soft">No feedback yet{personFilter ? ' for this filter' : ''}.</p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {grouped.map(([week, rows]) => (
          <div key={week}>
            <p className="mb-1.5 text-xs font-bold tracking-wide text-ink-soft uppercase">
              Week of {formatDayLabel(week)}
            </p>
            <div className="flex flex-col gap-2">
              {rows.map((f) => (
                <Card key={f.id}>
                  <div className="flex items-baseline justify-between">
                    <p className="font-display">{recipeMap.get(f.recipeId)?.name ?? 'Deleted recipe'}</p>
                    <p className="text-xs text-ink-soft">{formatDayLabel(f.date)}</p>
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-0.5 text-sm">
                    {f.entries
                      .filter((e) => !personFilter || e.personId === personFilter)
                      .map((e) => (
                        <li key={e.personId} className="flex items-baseline gap-2">
                          <span className="w-16 shrink-0 font-semibold">{personName(e.personId)}</span>
                          <span>{ENJOY_OPTIONS.find((o) => o.value === e.enjoyment)?.emoji}</span>
                          <span className="text-ink-soft">ate {e.ateAmount}</span>
                          {e.note && <span className="text-ink-soft">· "{e.note}"</span>}
                        </li>
                      ))}
                  </ul>
                  {(f.overallNote || f.cookNotes) && (
                    <p className="mt-1.5 text-sm text-ink-soft">
                      {f.overallNote && <>"{f.overallNote}"</>}
                      {f.overallNote && f.cookNotes && ' · '}
                      {f.cookNotes && <>cook: "{f.cookNotes}"</>}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-h-10 cursor-pointer rounded-full px-3.5 text-sm font-bold ${
        active ? 'bg-primary text-white' : 'bg-mist text-ink-soft'
      }`}
    >
      {children}
    </button>
  );
}
