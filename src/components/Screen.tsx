import type { ReactNode } from 'react';

/** Page wrapper: header + safe padding above the fixed tab bar. */
export function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <header className="mb-4">
        <h1 className="font-display text-2xl text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
      </header>
      {children}
    </main>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}
