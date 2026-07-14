// Prep timeline computation (spec §5). Pure functions — unit tested.
// stepClockTime = serveTime + offsetMinutes; recomputed live on serve-time edits.

import type { PrepStep } from '../types';
import { timeOnDate } from './dates';

export interface TimelineStep extends PrepStep {
  due: Date;
  pastDue: boolean;
}

/** All steps with computed due times, ordered by when they happen. */
export function computeTimeline(steps: PrepStep[], serveAt: Date, now: Date): TimelineStep[] {
  return steps
    .slice()
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.order - b.order)
    .map((s) => {
      const due = new Date(serveAt.getTime() + s.offsetMinutes * 60_000);
      return { ...s, due, pastDue: now.getTime() > due.getTime() };
    });
}

/** Timeline for a planned meal on a given day ("2026-07-14", "18:00"). */
export function mealTimeline(
  steps: PrepStep[],
  dateISO: string,
  serveTime: string,
  now: Date
): TimelineStep[] {
  return computeTimeline(steps, timeOnDate(dateISO, serveTime), now);
}

export function advanceSteps(timeline: TimelineStep[]): TimelineStep[] {
  return timeline.filter((s) => s.type === 'advance');
}

export function cookSteps(timeline: TimelineStep[]): TimelineStep[] {
  return timeline.filter((s) => s.type === 'cook');
}

/** Has the serve moment passed? Drives the "Log feedback" card. */
export function servePassed(dateISO: string, serveTime: string, now: Date): boolean {
  return now.getTime() > timeOnDate(dateISO, serveTime).getTime();
}
