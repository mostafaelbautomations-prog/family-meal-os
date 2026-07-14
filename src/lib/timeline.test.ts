import { describe, expect, it } from 'vitest';
import type { PrepStep } from '../types';
import { advanceSteps, computeTimeline, cookSteps, mealTimeline, servePassed } from './timeline';

function step(order: number, offsetMinutes: number, type: 'advance' | 'cook'): PrepStep {
  return { id: `s${order}`, order, instruction: `step ${order}`, offsetMinutes, type };
}

const serveAt = new Date(2026, 6, 14, 18, 0); // 18:00

describe('computeTimeline', () => {
  it('computes clock times from serve time + offsets', () => {
    const tl = computeTimeline([step(1, -60, 'cook'), step(2, -480, 'advance')], serveAt, new Date(2026, 6, 14, 9, 0));
    // sorted by offset: advance (-480) first
    expect(tl[0].id).toBe('s2');
    expect(tl[0].due.getHours()).toBe(10); // 18:00 - 8h
    expect(tl[1].due.getHours()).toBe(17); // 18:00 - 1h
  });

  it('flags past-due steps', () => {
    const now = new Date(2026, 6, 14, 12, 0); // noon
    const tl = computeTimeline([step(1, -480, 'advance'), step(2, -60, 'cook')], serveAt, now);
    expect(tl[0].pastDue).toBe(true); // was due 10:00
    expect(tl[1].pastDue).toBe(false); // due 17:00
  });

  it('recomputes when serve time changes', () => {
    const now = new Date(2026, 6, 14, 11, 0);
    const steps = [step(1, -480, 'advance')];
    const early = computeTimeline(steps, new Date(2026, 6, 14, 18, 0), now);
    const late = computeTimeline(steps, new Date(2026, 6, 14, 20, 0), now);
    expect(early[0].pastDue).toBe(true); // due 10:00
    expect(late[0].pastDue).toBe(false); // due 12:00
  });

  it('breaks offset ties by step order', () => {
    const tl = computeTimeline([step(2, -30, 'cook'), step(1, -30, 'cook')], serveAt, serveAt);
    expect(tl.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('mealTimeline', () => {
  it('builds from ISO date + HH:mm strings', () => {
    const tl = mealTimeline([step(1, -90, 'cook')], '2026-07-14', '18:00', new Date(2026, 6, 14, 12, 0));
    expect(tl[0].due.getHours()).toBe(16);
    expect(tl[0].due.getMinutes()).toBe(30);
  });
});

describe('filters', () => {
  it('splits advance and cook steps', () => {
    const tl = computeTimeline(
      [step(1, -480, 'advance'), step(2, -60, 'cook'), step(3, -120, 'advance')],
      serveAt,
      serveAt
    );
    expect(advanceSteps(tl).map((s) => s.id)).toEqual(['s1', 's3']);
    expect(cookSteps(tl).map((s) => s.id)).toEqual(['s2']);
  });
});

describe('servePassed', () => {
  it('is false before and true after serve time', () => {
    expect(servePassed('2026-07-14', '18:00', new Date(2026, 6, 14, 17, 59))).toBe(false);
    expect(servePassed('2026-07-14', '18:00', new Date(2026, 6, 14, 18, 1))).toBe(true);
  });
});
