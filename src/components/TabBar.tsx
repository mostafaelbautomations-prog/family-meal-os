import { NavLink } from 'react-router-dom';
import { IconCart, IconLog, IconSettings, IconToday, IconWeek } from './Icons';

const TABS = [
  { to: '/', label: 'Today', Icon: IconToday },
  { to: '/week', label: 'Week', Icon: IconWeek },
  { to: '/log', label: 'Log', Icon: IconLog },
  { to: '/grocery', label: 'Grocery', Icon: IconCart },
  { to: '/settings', label: 'Settings', Icon: IconSettings },
];

export function TabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[11px] font-semibold transition-colors ${
                isActive ? 'text-primary' : 'text-ink-soft'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={24} strokeWidth={isActive ? 2.4 : 2} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
