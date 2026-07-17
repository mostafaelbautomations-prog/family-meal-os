import { describe, expect, it } from 'vitest';
import {
  decodeGroupRequest,
  decodeReply,
  decodeRequest,
  encodePayload,
  groupRequestLink,
  ratingToEnjoyment,
  replyLink,
  requestLink,
  type GroupRatingRequest,
  type RatingReply,
  type RatingRequest,
} from './ratingLinks';

const req: RatingRequest = {
  v: 1,
  t: 'req',
  mealId: 'm1',
  recipeId: 'r1',
  personId: 'p1',
  person: 'Dad',
  meal: 'Chicken Tacos',
  date: '2026-07-15',
};

const res: RatingReply = {
  ...req,
  t: 'res',
  rating: 8,
  enjoyed: 'The crispy edges 🌮',
  improve: 'أكثر صلصة (more sauce)',
};

describe('rating link payloads', () => {
  it('round-trips a request', () => {
    expect(decodeRequest(encodePayload(req))).toEqual(req);
  });

  it('round-trips a reply with emoji and Arabic text', () => {
    expect(decodeReply(encodePayload(res))).toEqual(res);
  });

  it('rejects garbage and cross-type decoding', () => {
    expect(decodeRequest('not-base64!!!')).toBeNull();
    expect(decodeRequest(encodePayload(res))).toBeNull(); // reply ≠ request
    expect(decodeReply(encodePayload(req))).toBeNull();
  });

  it('rejects payloads missing fields', () => {
    const broken = { ...req } as Record<string, unknown>;
    delete broken.personId;
    const param = encodePayload(broken as unknown as RatingRequest);
    expect(decodeRequest(param)).toBeNull();
  });

  it('clamps out-of-range ratings and truncates long text', () => {
    const wild = { ...res, rating: 47, enjoyed: 'x'.repeat(2000) };
    const decoded = decodeReply(encodePayload(wild));
    expect(decoded?.rating).toBe(10);
    expect(decoded?.enjoyed.length).toBe(500);
  });

  it('builds URLs with the payload in the d param', () => {
    const url = requestLink(req, 'https://example.com/app/');
    expect(url.startsWith('https://example.com/app/rate?d=')).toBe(true);
    const reply = replyLink(res, 'https://example.com/app/');
    expect(reply.startsWith('https://example.com/app/rate/return?d=')).toBe(true);
    // param survives URL round-trip
    const param = new URL(url).searchParams.get('d')!;
    expect(decodeRequest(param)).toEqual(req);
  });
});

describe('group rating link (one link for the family chat)', () => {
  const greq: GroupRatingRequest = {
    v: 1,
    t: 'greq',
    mealId: 'm1',
    recipeId: 'r1',
    meal: 'Chicken Tacos',
    date: '2026-07-15',
    people: [
      { id: 'p1', name: 'Dad' },
      { id: 'p2', name: 'Mom' },
      { id: 'p3', name: 'Marwan' },
    ],
  };

  it('round-trips a group request', () => {
    expect(decodeGroupRequest(encodePayload(greq))).toEqual(greq);
  });

  it('is not decodable as a single request (and vice versa)', () => {
    expect(decodeRequest(encodePayload(greq))).toBeNull();
    expect(decodeGroupRequest(encodePayload(req))).toBeNull();
  });

  it('rejects an empty or malformed people list', () => {
    const empty = { ...greq, people: [] };
    expect(decodeGroupRequest(encodePayload(empty as GroupRatingRequest))).toBeNull();
    const bad = { ...greq, people: [{ id: 'p1' }] };
    expect(decodeGroupRequest(encodePayload(bad as unknown as GroupRatingRequest))).toBeNull();
  });

  it('builds a /rate URL that survives the round-trip', () => {
    const url = groupRequestLink(greq, 'https://example.com/app/');
    expect(url.startsWith('https://example.com/app/rate?d=')).toBe(true);
    const param = new URL(url).searchParams.get('d')!;
    expect(decodeGroupRequest(param)?.people.map((p) => p.name)).toEqual(['Dad', 'Mom', 'Marwan']);
  });
});

describe('ratingToEnjoyment (1–10 → 1–5)', () => {
  it('maps the scale sensibly', () => {
    expect(ratingToEnjoyment(1)).toBe(1);
    expect(ratingToEnjoyment(2)).toBe(1);
    expect(ratingToEnjoyment(5)).toBe(3);
    expect(ratingToEnjoyment(8)).toBe(4);
    expect(ratingToEnjoyment(10)).toBe(5);
  });
});
