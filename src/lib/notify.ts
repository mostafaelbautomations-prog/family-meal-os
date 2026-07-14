// Local notifications (spec §8) — implemented honestly: fired only while the
// app is alive at the due time; the red past-due state in Today is the real
// safety net. No push server (would violate the $0 constraint).

const FIRED_KEY = 'mealos.notifiedSteps';

function firedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function notificationsSupported(): boolean {
  return 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** Fire once per step (dedup persisted so reopening the app doesn't re-ping). */
export function fireStepNotification(uniqueId: string, title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const fired = firedSet();
  if (fired.has(uniqueId)) return;
  fired.add(uniqueId);
  // keep the dedup list from growing forever
  const trimmed = [...fired].slice(-200);
  localStorage.setItem(FIRED_KEY, JSON.stringify(trimmed));
  try {
    new Notification(title, { body, icon: './pwa-192x192.png' });
  } catch {
    // Some platforms (Android Chrome) only allow SW-shown notifications; the
    // in-app timeline still covers the reminder.
  }
}

/** Badge the app icon with the number of unlogged cooked meals (spec §8). */
export function setAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) void nav.setAppBadge?.(count);
  else void nav.clearAppBadge?.();
}
