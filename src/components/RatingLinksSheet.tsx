// Bottom sheet listing one personal rating link per active family member.
// Share via the native sheet (WhatsApp/iMessage) or copy. Received ratings
// show a check so the cook can see who's answered.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { peopleRepo, ratingsRepo } from '../db/repo';
import { requestLink } from '../lib/ratingLinks';
import { IconCheck, IconCopy, IconX } from './Icons';

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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const [people, ratings] = await Promise.all([peopleRepo.all(), ratingsRepo.forMeal(plannedMealId)]);
    return {
      people: people.filter((p) => p.active),
      rated: new Map(ratings.map((r) => [r.personId, r.rating])),
    };
  }, [plannedMealId]);

  function linkFor(personId: string, person: string): string {
    return requestLink({ mealId: plannedMealId, recipeId, personId, person, meal: recipeName, date });
  }

  async function share(personId: string, person: string) {
    const url = linkFor(personId, person);
    const text = `${person}, rate tonight's ${recipeName}! ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // dismissed — fall through to copy
      }
    }
    await navigator.clipboard.writeText(text);
    setCopiedId(personId);
    setTimeout(() => setCopiedId(null), 2500);
  }

  async function copy(personId: string, person: string) {
    await navigator.clipboard.writeText(linkFor(personId, person));
    setCopiedId(personId);
    setTimeout(() => setCopiedId(null), 2500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Family rating links"
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
          Send each person their link. They rate 1–10 on their phone and send a link back — open it
          here and it saves automatically.
        </p>

        <ul className="flex flex-col divide-y divide-line">
          {data?.people.map((p) => {
            const rating = data.rated.get(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="flex-1 font-semibold">
                  {p.name}
                  {rating !== undefined && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                      <IconCheck size={12} strokeWidth={3} /> {rating}/10
                    </span>
                  )}
                </span>
                <button
                  onClick={() => void share(p.id, p.name)}
                  className="min-h-11 cursor-pointer rounded-xl bg-primary px-4 text-sm font-bold text-on-strong"
                >
                  {copiedId === p.id ? 'Copied!' : 'Share'}
                </button>
                <button
                  onClick={() => void copy(p.id, p.name)}
                  aria-label={`Copy link for ${p.name}`}
                  className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-line text-ink-soft"
                >
                  <IconCopy size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
