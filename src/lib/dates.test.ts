import { describe, expect, it } from 'vitest';
import { isWeekendDate, timeOnDate, weekDates, weekStartISO } from './dates';

describe('week math (Sunday start, Fri/Sat weekend)', () => {
  it('weekStartISO returns the Sunday of the week', () => {
    // 2026-07-14 is a Tuesday; its week starts Sunday 2026-07-12
    expect(weekStartISO(new Date(2026, 6, 14))).toBe('2026-07-12');
    // A Sunday is its own week start
    expect(weekStartISO(new Date(2026, 6, 12))).toBe('2026-07-12');
    // Saturday belongs to the week that started the previous Sunday
    expect(weekStartISO(new Date(2026, 6, 18))).toBe('2026-07-12');
  });

  it('weekDates returns Sun..Sat', () => {
    const dates = weekDates('2026-07-12');
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-07-12'); // Sun
    expect(dates[5]).toBe('2026-07-17'); // Fri
    expect(dates[6]).toBe('2026-07-18'); // Sat
  });

  it('weekend is Friday and Saturday only', () => {
    expect(isWeekendDate('2026-07-17')).toBe(true); // Fri
    expect(isWeekendDate('2026-07-18')).toBe(true); // Sat
    expect(isWeekendDate('2026-07-12')).toBe(false); // Sun
    expect(isWeekendDate('2026-07-16')).toBe(false); // Thu
  });

  it('timeOnDate combines an ISO date with HH:mm', () => {
    const d = timeOnDate('2026-07-14', '18:30');
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(30);
    expect(d.getDate()).toBe(14);
  });
});
