// Bottom sheet with ONE rating link for the whole family group chat. Each
// person opens it, taps their own name, and rates. Received ratings show a
// check per person so the cook can see who's answered.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { peopleRepo, ratingsRepo } from '../db/repo';
import { groupRequestLink } from '../lib/ratingLinks';
import { IconCheck, IconCopy, IconShare, IconX } from './Icons';

export function RatingLinksSheet({
  plannedMealId,
  recipeId,
  recipeName,
  date,
  onClose,
}: {
  plannedMealId: string;
  recipeId: string;
  recipeName: string;
  date: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const data = useLiveQuery(async () => {
    const [people, ratings] = await Promise.all([peopleRepo.all(), ratingsRepo.forMeal(plannedMealId)]);
    return {
      people: people.filter((p) => p.active),
      rated: new Map(ratings.map((r) => [r.personId, r.rating])),
    };
  }, [plannedMealId]);

  function link(): string {
    return groupRequestLink({
      mealId: plannedMealId,
      recipeId,
      meal: recipeName,
      date,
      people: (data?.people ?? []).map((p) => ({ id: p.id, name: p.name })),
    });
  }

  const message = () => `Everyone — rate tonight's ${recipeName}! Tap, pick your name, 30 seconds:\n${link()}`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text: message() });
        return;
      } catch {
        // dismissed — fall through to copy
      }
    }
    await copy();
  }

  async function copy() {
    await navigator.clipboard.writeText(message());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Family rating link"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg">Rate {recipeName}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-mist text-ink-soft"
          >
            <IconX size={20} />
          </button>
        </div>
        <p className="mb-3 text-sm text-ink-soft">
          Drop this one link in the family chat. Each person taps it, picks their name, and rates —
          they send a link back and you open it here.
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => void share()}
            disabled={!data}
            className="flex min-h-13 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary font-display text-on-strong disabled:opacity-50"
          >
            <IconShare size={18} /> {copied ? 'Copied!' : 'Share the family link'}
          </button>
          <button
            onClick={() => void copy()}
            disabled={!data}
            aria-label="Copy the family link"
            className="flex h-13 w-13 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-line text-ink-soft disabled:opacity-50"
          >
            <IconCopy size={18} />
          </button>
        </div>

        <h3 className="mt-4 mb-1 text-xs font-bold tracking-wide text-ink-soft uppercase">Who's answered</h3>
        <ul className="flex flex-wrap gap-1.5">
          {data?.people.map((p) => {
            const rating = data.rated.get(p.id);
            return (
              <li
                key={p.id}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold ${
                  rating !== undefined ? 'bg-accent/15 text-accent' : 'bg-mist text-ink-soft'
                }`}
              >
                {rating !== undefined && <IconCheck size={14} strokeWidth={3} />}
                {p.name}
                {rating !== undefined && <span className="font-bold">{rating}/10</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
