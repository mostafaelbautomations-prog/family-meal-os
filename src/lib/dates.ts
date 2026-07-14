// Week math. Hard rule #1: week starts SUNDAY, weekend is Friday + Saturday.
// Every date-fns week call must pass { weekStartsOn: 0 } — never rely on defaults.

import { addDays, format, getDay, isSameDay, parseISO, startOfWeek } from 'date-fns';

export const WEEK_STARTS_ON = 0 as const; // Sunday

/** ISO date (yyyy-MM-dd) of the Sunday starting the week containing `d`. */
export function weekStartISO(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: WEEK_STARTS_ON }), 'yyyy-MM-dd');
}

/** The 7 ISO dates of the week starting at `weekStartDate` (a Sunday). */
export function weekDates(weekStartDate: string): string[] {
  const start = parseISO(weekStartDate);
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'));
}

/** Friday (5) and Saturday (6) are the weekend. */
export function isWeekendDate(isoDate: string): boolean {
  const dow = getDay(parseISO(isoDate));
  return dow === 5 || dow === 6;
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function isToday(isoDate: string): boolean {
  return isSameDay(parseISO(isoDate), new Date());
}

/** "18:00" + an ISO date → Date object on that date. */
export function timeOnDate(isoDate: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = parseISO(isoDate);
  d.setHours(h, m, 0, 0);
  return d;
}

export function formatClock(d: Date): string {
  return format(d, 'HH:mm');
}

export function formatDayLabel(isoDate: string): string {
  return format(parseISO(isoDate), 'EEEE d MMM');
}
