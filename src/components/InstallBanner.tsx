// First-visit install nudge (spec §2). iOS Safari gets add-to-home-screen
// instructions (no install API there); Chromium browsers get a real Install
// button via beforeinstallprompt.

import { useEffect, useState } from 'react';
import { IconX } from './Icons';

const DISMISS_KEY = 'mealos.installBannerDismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's non-standard flag
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

export function InstallBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (dismissed || isStandalone()) return null;
  if (!isIos() && !installEvent) return null; // nothing useful to offer

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="mx-4 mt-[max(0.75rem,env(safe-area-inset-top))] flex items-start gap-3 rounded-2xl bg-primary p-3.5 text-on-strong">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold">Install Family Meal OS</p>
        {isIos() ? (
          <p className="mt-0.5 opacity-90">
            Installing keeps your data safe and works offline: tap the Share button, then{' '}
            <span className="font-semibold">"Add to Home Screen"</span>.
          </p>
        ) : (
          <button
            onClick={() => void installEvent?.prompt()}
            className="mt-1.5 min-h-11 cursor-pointer rounded-lg bg-on-strong px-4 font-bold text-primary"
          >
            Install app
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss install banner"
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-on-strong/80"
      >
        <IconX size={18} />
      </button>
    </div>
  );
}
