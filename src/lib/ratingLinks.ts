// Share-link rating flow (spec §12 "share-link hack", now v1): no backend, so
// everything travels inside URLs. The cook drops ONE group link in the family
// chat; each person opens it, taps their own name, and rates. Submitting
// builds a REPLY link they send back; opening that on the cook's device
// imports the rating. Pure functions — unit tested.
// (Legacy per-person 'req' links still decode, so old messages keep working.)

export interface RatingRequest {
  v: 1;
  t: 'req';
  mealId: string; // plannedMealId
  recipeId: string;
  personId: string;
  person: string; // display name, so the form works with zero local data
  meal: string; // recipe name
  date: string; // ISO date of the meal
}

export interface RatingRequestPerson {
  id: string;
  name: string;
}

/** One link for the whole group chat — the opener picks their name first. */
export interface GroupRatingRequest {
  v: 1;
  t: 'greq';
  mealId: string;
  recipeId: string;
  meal: string;
  date: string;
  people: RatingRequestPerson[];
}

export interface RatingReply {
  v: 1;
  t: 'res';
  mealId: string;
  recipeId: string;
  personId: string;
  person: string;
  meal: string;
  date: string;
  rating: number; // 1–10
  enjoyed: string;
  improve: string;
}

const MAX_TEXT = 500;

// --- base64url (unicode-safe) ---------------------------------------------------

export function encodePayload(obj: RatingRequest | GroupRatingRequest | RatingReply): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeRaw(param: string): unknown {
  const b64 = param.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const strFields = ['mealId', 'recipeId', 'personId', 'person', 'meal', 'date'] as const;

export function decodeRequest(param: string): RatingRequest | null {
  try {
    const d = decodeRaw(param);
    if (!isRecord(d) || d.v !== 1 || d.t !== 'req') return null;
    if (!strFields.every((f) => typeof d[f] === 'string' && d[f])) return null;
    const r = d as unknown as RatingRequest;
    return { v: 1, t: 'req', mealId: r.mealId, recipeId: r.recipeId, personId: r.personId, person: r.person, meal: r.meal, date: r.date };
  } catch {
    return null;
  }
}

const groupStrFields = ['mealId', 'recipeId', 'meal', 'date'] as const;
const MAX_PEOPLE = 12;

export function decodeGroupRequest(param: string): GroupRatingRequest | null {
  try {
    const d = decodeRaw(param);
    if (!isRecord(d) || d.v !== 1 || d.t !== 'greq') return null;
    if (!groupStrFields.every((f) => typeof d[f] === 'string' && d[f])) return null;
    if (!Array.isArray(d.people) || d.people.length === 0 || d.people.length > MAX_PEOPLE) return null;
    const people: RatingRequestPerson[] = [];
    for (const p of d.people) {
      if (!isRecord(p) || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim()) {
        return null;
      }
      people.push({ id: p.id, name: p.name.trim().slice(0, 40) });
    }
    const r = d as unknown as GroupRatingRequest;
    return { v: 1, t: 'greq', mealId: r.mealId, recipeId: r.recipeId, meal: r.meal, date: r.date, people };
  } catch {
    return null;
  }
}

export function decodeReply(param: string): RatingReply | null {
  try {
    const d = decodeRaw(param);
    if (!isRecord(d) || d.v !== 1 || d.t !== 'res') return null;
    if (!strFields.every((f) => typeof d[f] === 'string' && d[f])) return null;
    if (typeof d.rating !== 'number' || !Number.isFinite(d.rating)) return null;
    const rating = Math.min(10, Math.max(1, Math.round(d.rating)));
    const text = (x: unknown) => (typeof x === 'string' ? x.slice(0, MAX_TEXT) : '');
    const r = d as unknown as RatingReply;
    return {
      v: 1,
      t: 'res',
      mealId: r.mealId,
      recipeId: r.recipeId,
      personId: r.personId,
      person: r.person,
      meal: r.meal,
      date: r.date,
      rating,
      enjoyed: text(d.enjoyed),
      improve: text(d.improve),
    };
  } catch {
    return null;
  }
}

// --- URL builders ------------------------------------------------------------------

/** App root (works on localhost, LAN IPs and the Pages subpath alike). */
export function appBaseUrl(): string {
  return location.origin + import.meta.env.BASE_URL;
}

export function requestLink(req: Omit<RatingRequest, 'v' | 't'>, base = appBaseUrl()): string {
  return `${base}rate?d=${encodePayload({ v: 1, t: 'req', ...req })}`;
}

export function groupRequestLink(req: Omit<GroupRatingRequest, 'v' | 't'>, base = appBaseUrl()): string {
  return `${base}rate?d=${encodePayload({ v: 1, t: 'greq', ...req })}`;
}

export function replyLink(res: Omit<RatingReply, 'v' | 't'>, base = appBaseUrl()): string {
  return `${base}rate/return?d=${encodePayload({ v: 1, t: 'res', ...res })}`;
}

/** Map a 1–10 self-rating onto the 1–5 enjoyment scale the engine uses. */
export function ratingToEnjoyment(rating: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.ceil(rating / 2))) as 1 | 2 | 3 | 4 | 5;
}
