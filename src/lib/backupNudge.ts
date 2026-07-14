// Weekly backup reminder (spec §4.5 / Phase 6). IndexedDB can be evicted, so
// the nudge reappears until the user exports.

const LAST_EXPORT_KEY = 'mealos.lastExport';
const SNOOZE_KEY = 'mealos.backupNudgeSnoozedUntil';
const FIRST_RUN_KEY = 'mealos.firstRun';

const DAY = 24 * 60 * 60 * 1000;

export function recordExport(): void {
  localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
}

export function lastExportAt(): Date | null {
  const raw = localStorage.getItem(LAST_EXPORT_KEY);
  return raw ? new Date(raw) : null;
}

export function snoozeNudge(days = 2): void {
  localStorage.setItem(SNOOZE_KEY, new Date(Date.now() + days * DAY).toISOString());
}

export function backupNudgeDue(now = new Date()): boolean {
  if (!localStorage.getItem(FIRST_RUN_KEY)) {
    localStorage.setItem(FIRST_RUN_KEY, now.toISOString());
  }
  const snoozedUntil = localStorage.getItem(SNOOZE_KEY);
  if (snoozedUntil && now.getTime() < new Date(snoozedUntil).getTime()) return false;

  const last = lastExportAt();
  if (last) return now.getTime() - last.getTime() > 7 * DAY;

  const firstRun = new Date(localStorage.getItem(FIRST_RUN_KEY)!);
  return now.getTime() - firstRun.getTime() > 3 * DAY; // never exported: nudge after 3 days of use
}
