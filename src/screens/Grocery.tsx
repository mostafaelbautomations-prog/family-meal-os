// Grocery: Needed/Bought (tap to move, long-press to delete), manual quick-add,
// fill-from-plan, and the collapsible staples panel with 3-state levels.

import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, Screen } from '../components/Screen';
import { groceryRepo, pantryRepo, regenerateGroceryFromPlan, weekPlansRepo } from '../db/repo';
import type { GroceryItem, GrocerySource, StapleLevel } from '../types';
import { IconCart, IconCheck, IconChevronRight, IconPlus } from '../components/Icons';

const SOURCE_LABEL: Record<GrocerySource, string> = {
  'auto-recipe': 'plan',
  'ran-out': 'ran out',
  manual: '',
  'staple-low': 'staple',
};

export function GroceryScreen() {
  const [draft, setDraft] = useState('');
  const [flash, setFlash] = useState('');

  const data = useLiveQuery(async () => {
    const [items, staples, plan] = await Promise.all([
      groceryRepo.all(),
      pantryRepo.all(),
      weekPlansRepo.activePlan(),
    ]);
    return {
      needed: items.filter((i) => i.status === 'needed').sort((a, b) => a.name.localeCompare(b.name)),
      bought: items.filter((i) => i.status === 'bought').sort((a, b) => a.name.localeCompare(b.name)),
      staples: staples.sort((a, b) => a.name.localeCompare(b.name)),
      planId: plan?.id,
    };
  });

  async function quickAdd() {
    const name = draft.trim();
    if (!name) return;
    await groceryRepo.add(name, 'manual');
    setDraft('');
  }

  async function fillFromPlan() {
    if (!data?.planId) return;
    const count = await regenerateGroceryFromPlan(data.planId);
    setFlash(`Added ${count} items from this week's plan.`);
    setTimeout(() => setFlash(''), 4000);
  }

  if (!data) return <Screen title="Grocery">{null}</Screen>;

  return (
    <Screen title="Grocery" subtitle="Shopping list & staples">
      {/* Quick add */}
      <div className="mb-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
          placeholder="Add item…"
          className="min-h-12 flex-1 rounded-xl border border-line bg-surface px-3"
        />
        <button
          onClick={() => void quickAdd()}
          disabled={!draft.trim()}
          aria-label="Add to list"
          className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl bg-primary text-on-strong disabled:opacity-40"
        >
          <IconPlus size={22} />
        </button>
      </div>

      {/* Needed */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg">Needed</h2>
          {data.planId && (
            <button
              onClick={() => void fillFromPlan()}
              className="min-h-11 cursor-pointer rounded-lg px-2 text-sm font-bold text-primary"
            >
              Fill from week plan
            </button>
          )}
        </div>
        {flash && <p className="mb-2 text-sm font-semibold text-accent">{flash}</p>}
        {data.needed.length === 0 ? (
          <Card>
            <p className="text-ink-soft">Nothing needed. Tap "Fill from week plan" or add items above.</p>
          </Card>
        ) : (
          <Card className="!p-2">
            <ul className="flex flex-col divide-y divide-line">
              {data.needed.map((item) => (
                <GroceryRow key={item.id} item={item} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Bought */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg">Bought</h2>
          {data.bought.length > 0 && (
            <button
              onClick={() => void groceryRepo.clearBought()}
              className="min-h-11 cursor-pointer rounded-lg px-2 text-sm font-bold text-danger"
            >
              Clear bought
            </button>
          )}
        </div>
        {data.bought.length === 0 ? (
          <p className="text-sm text-ink-soft">Tap items above as you shop — they move here.</p>
        ) : (
          <Card className="!p-2">
            <ul className="flex flex-col divide-y divide-line">
              {data.bought.map((item) => (
                <GroceryRow key={item.id} item={item} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <StaplesPanel staples={data.staples} />

      <p className="mt-4 text-center text-xs text-ink-soft">
        Tap an item to move it · hold to delete
      </p>
    </Screen>
  );
}

// --- One grocery row (tap = toggle, long-press = delete) -----------------------

function GroceryRow({ item }: { item: GroceryItem }) {
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);
  const bought = item.status === 'bought';

  function startHold() {
    held.current = false;
    holdTimer.current = setTimeout(() => {
      held.current = true;
      if ('vibrate' in navigator) navigator.vibrate(50);
      void groceryRepo.remove(item.id);
    }, 550);
  }

  function cancelHold() {
    clearTimeout(holdTimer.current);
  }

  return (
    <li>
      <button
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (!held.current) void groceryRepo.setStatus(item.id, bought ? 'needed' : 'bought');
        }}
        className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-2 py-1 text-left select-none"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
            bought ? 'border-accent bg-accent text-on-strong' : 'border-line'
          }`}
        >
          {bought ? <IconCheck size={16} strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold capitalize ${bought ? 'text-ink-soft line-through' : ''}`}>
            {item.name}
          </span>
          {item.quantity && <span className="block text-xs text-ink-soft">{item.quantity}</span>}
        </span>
        {SOURCE_LABEL[item.source] && (
          <span className="shrink-0 rounded-full bg-mist px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-soft uppercase">
            {SOURCE_LABEL[item.source]}
          </span>
        )}
      </button>
    </li>
  );
}

// --- Staples panel ---------------------------------------------------------------

const LEVELS: { value: StapleLevel; label: string }[] = [
  { value: 'stocked', label: 'Stocked' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out' },
];

const LEVEL_ACTIVE: Record<StapleLevel, string> = {
  stocked: 'bg-accent text-on-strong',
  low: 'bg-secondary text-on-strong',
  out: 'bg-danger text-on-strong',
};

function StaplesPanel({ staples }: { staples: { id: string; name: string; level: StapleLevel }[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <Card>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-display text-lg">
          <IconCart size={20} className="text-secondary" /> Pantry staples
        </span>
        <IconChevronRight size={20} className={`text-ink-soft transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="mt-3">
          <ul className="flex flex-col divide-y divide-line">
            {staples.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <span className="font-semibold capitalize">{s.name}</span>
                <div className="flex rounded-lg bg-mist p-0.5" role="radiogroup" aria-label={`${s.name} level`}>
                  {LEVELS.map((lv) => (
                    <button
                      key={lv.value}
                      role="radio"
                      aria-checked={s.level === lv.value}
                      onClick={() => void pantryRepo.setLevel(s.id, lv.value)}
                      className={`min-h-10 cursor-pointer rounded-md px-2.5 text-xs font-bold ${
                        s.level === lv.value ? LEVEL_ACTIVE[lv.value] : 'text-ink-soft'
                      }`}
                    >
                      {lv.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  void pantryRepo.add(draft);
                  setDraft('');
                }
              }}
              placeholder="Add staple…"
              className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
            />
            <button
              onClick={() => {
                if (draft.trim()) {
                  void pantryRepo.add(draft);
                  setDraft('');
                }
              }}
              disabled={!draft.trim()}
              aria-label="Add staple"
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-primary text-primary disabled:opacity-40"
            >
              <IconPlus size={18} />
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Low or out staples appear in Needed automatically. Buying one restocks it.
          </p>
        </div>
      )}
    </Card>
  );
}
