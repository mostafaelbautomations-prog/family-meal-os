// Share-link rating screens.
// /rate         — opened on a FAMILY MEMBER's phone. Renders entirely from the
//                 URL payload (their browser has none of the cook's data).
//                 Group links ask "who are you?" first; then the rating form.
//                 Submitting builds a reply link to send back.
// /rate/return  — opened on the COOK's phone from that reply link; saves the
//                 rating into the local DB.

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../components/Screen';
import { ratingsRepo, settingsRepo } from '../db/repo';
import {
  decodeGroupRequest,
  decodeReply,
  decodeRequest,
  replyLink,
  type RatingRequest,
  type RatingRequestPerson,
  type RatingReply,
} from '../lib/ratingLinks';
import { getApiKey } from '../lib/apiKey';
import { runLiveReview } from '../ai/review';
import { outcomeLine } from '../components/ReviewPanel';
import { IconCheck, IconCopy, IconSparkles } from '../components/Icons';

// --- Member-facing form ----------------------------------------------------------

export function RateScreen() {
  const [params] = useSearchParams();
  // One link now serves the whole group chat; legacy per-person links still work.
  const group = useMemo(() => decodeGroupRequest(params.get('d') ?? ''), [params]);
  const legacy = useMemo(() => decodeRequest(params.get('d') ?? ''), [params]);
  const [who, setWho] = useState<RatingRequestPerson | null>(null);

  const request: RatingRequest | null =
    legacy ??
    (group && who
      ? {
          v: 1,
          t: 'req',
          mealId: group.mealId,
          recipeId: group.recipeId,
          personId: who.id,
          person: who.name,
          meal: group.meal,
          date: group.date,
        }
      : null);

  const [rating, setRating] = useState<number | null>(null);
  const [enjoyed, setEnjoyed] = useState('');
  const [improve, setImprove] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!request && !group) {
    return (
      <Shell>
        <Card>
          <p className="font-semibold">This rating link doesn't work.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Ask the cook to send a fresh one — the link may have been cut off while copying.
          </p>
        </Card>
      </Shell>
    );
  }

  // Group link, name not picked yet → "who are you?"
  if (!request && group) {
    return (
      <Shell>
        <h1 className="font-display text-2xl">Who are you?</h1>
        <p className="mt-1 text-ink-soft">
          Rating <span className="font-bold text-ink">{group.meal}</span> — tap your name.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {group.people.map((p) => (
            <button
              key={p.id}
              onClick={() => setWho(p)}
              className="min-h-14 cursor-pointer rounded-2xl border border-line bg-surface font-display text-lg"
            >
              {p.name}
            </button>
          ))}
        </div>
      </Shell>
    );
  }
  if (!request) return null; // unreachable — narrows the type below

  const reply: Omit<RatingReply, 'v' | 't'> | null =
    rating === null
      ? null
      : {
          mealId: request.mealId,
          recipeId: request.recipeId,
          personId: request.personId,
          person: request.person,
          meal: request.meal,
          date: request.date,
          rating,
          enjoyed: enjoyed.trim(),
          improve: improve.trim(),
        };

  async function submit() {
    if (!reply) return;
    const url = replyLink(reply);
    setLink(url);
    const text = `${request!.person} rated ${request!.meal}: ${reply.rating}/10\n${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // user closed the share sheet — the copy fallback below stays visible
      }
    }
  }

  if (link) {
    return (
      <Shell>
        <Card className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-strong">
            <IconCheck size={28} strokeWidth={3} />
          </span>
          <h1 className="mt-3 font-display text-xl">Thanks, {request.person}!</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Last step: send this link back to the cook so your rating counts.
          </p>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
            className="mt-3 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-on-strong"
          >
            <IconCopy size={18} /> {copied ? 'Copied — paste it in your chat' : 'Copy reply link'}
          </button>
          {'share' in navigator && (
            <button
              onClick={() => void navigator.share({ text: `${request.person} rated ${request.meal}: ${rating}/10\n${link}` })}
              className="mt-2 min-h-12 w-full cursor-pointer rounded-xl border border-line font-semibold text-primary"
            >
              Share again
            </button>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-display text-2xl">Hey {request.person}!</h1>
      <p className="mt-1 text-ink-soft">
        How was <span className="font-bold text-ink">{request.meal}</span>?
        {group && who && (
          <button
            onClick={() => setWho(null)}
            className="ml-2 cursor-pointer text-sm font-bold text-primary underline"
          >
            Not {who.name}?
          </button>
        )}
      </p>

      <Card className="mt-4">
        <p className="mb-2 text-xs font-bold tracking-wide text-ink-soft uppercase">Rate it 1–10</p>
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              aria-pressed={rating === n}
              className={`min-h-12 cursor-pointer rounded-xl font-display text-lg ${
                rating === n ? 'bg-primary text-on-strong' : 'bg-mist text-ink'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-bold tracking-wide text-ink-soft uppercase">
            What did you enjoy about it?
          </span>
          <textarea
            value={enjoyed}
            onChange={(e) => setEnjoyed(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="The crispy bits, the sauce…"
            className="mt-1 w-full rounded-xl border border-line bg-surface p-3 text-sm"
          />
        </label>

        <label className="mt-2 block">
          <span className="text-xs font-bold tracking-wide text-ink-soft uppercase">
            How should it improve next time?
          </span>
          <textarea
            value={improve}
            onChange={(e) => setImprove(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Less salty, more sauce, softer rice…"
            className="mt-1 w-full rounded-xl border border-line bg-surface p-3 text-sm"
          />
        </label>

        <button
          onClick={() => void submit()}
          disabled={rating === null}
          className="mt-4 flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary font-display text-lg text-on-strong disabled:opacity-40"
        >
          Send my rating
        </button>
        {rating === null && (
          <p className="mt-1.5 text-center text-xs text-ink-soft">Pick a number first.</p>
        )}
      </Card>
    </Shell>
  );
}

// --- Cook-facing import ------------------------------------------------------------

export function RateReturnScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reply = useMemo(() => decodeReply(params.get('d') ?? ''), [params]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  // Instant mode: right after saving, check whether the family now agrees on
  // any change to this recipe (unanimous → applied on its own).
  const [analysis, setAnalysis] = useState<'off' | 'running' | 'done'>('off');
  const [analysisNote, setAnalysisNote] = useState('');

  if (!reply) {
    return (
      <Shell>
        <Card>
          <p className="font-semibold">This reply link doesn't work.</p>
          <p className="mt-1 text-sm text-ink-soft">
            It may have been cut off while copying — ask for it to be sent again.
          </p>
        </Card>
      </Shell>
    );
  }

  async function save() {
    try {
      await ratingsRepo.saveReply(reply!);
      setSaved(true);
    } catch {
      setError("Couldn't save the rating — try tapping Save again.");
      return;
    }

    const settings = await settingsRepo.get();
    const apiKey = getApiKey();
    if (settings?.aiMode !== 'live' || !apiKey) {
      setTimeout(() => navigate('/log'), 1200);
      return;
    }

    setAnalysis('running');
    try {
      const res = await runLiveReview(reply!.recipeId, apiKey);
      setAnalysisNote(
        res.ok ? outcomeLine(res.outcome) : 'Couldn’t check the reviews right now — you can do it from the Recipes tab.'
      );
    } catch (err) {
      setAnalysisNote(
        err instanceof Error && err.message
          ? `Couldn’t check the reviews (${err.message}) — you can do it from the Recipes tab.`
          : 'Couldn’t check the reviews right now — you can do it from the Recipes tab.'
      );
    }
    setAnalysis('done');
    setTimeout(() => navigate('/log'), 3000);
  }

  return (
    <Shell>
      <h1 className="font-display text-2xl">Rating received</h1>
      <Card className="mt-4">
        <p className="font-display text-lg">
          {reply.person} rated {reply.meal}
        </p>
        <p className="mt-1 font-display text-3xl text-primary">{reply.rating}/10</p>
        {reply.enjoyed && (
          <p className="mt-2 text-sm">
            <span className="font-bold text-ink-soft">Enjoyed:</span> {reply.enjoyed}
          </p>
        )}
        {reply.improve && (
          <p className="mt-1 text-sm">
            <span className="font-bold text-ink-soft">Improve:</span> {reply.improve}
          </p>
        )}
        {saved ? (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 font-semibold text-accent">
              <IconCheck size={18} strokeWidth={3} /> Saved — it'll shape next week's plan
            </p>
            {analysis === 'running' && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-soft">
                <IconSparkles size={16} className="animate-pulse text-primary" /> Checking if the family
                agrees on any changes…
              </p>
            )}
            {analysis === 'done' && (
              <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-secondary">
                <IconSparkles size={16} className="mt-0.5 shrink-0" /> {analysisNote}
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={() => void save()}
            className="mt-3 flex min-h-13 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-accent py-3 font-display text-on-strong"
          >
            <IconCheck size={20} /> Save rating
          </button>
        )}
        {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8">
      {children}
    </main>
  );
}
