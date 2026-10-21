'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon, type IconName } from './icon';

/**
 * The four main places. Shown only on the screens they lead to: a circle's own
 * page and the sign-in screens have a back button instead, so a half-finished
 * action is never one stray tap from being abandoned.
 */
const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/circles/new', label: 'Start', icon: 'plus' },
  { href: '/profile', label: 'Me', icon: 'user' },
];

const TAB_PATHS = TABS.map((t) => t.href);

export function TabBar() {
  const pathname = usePathname();
  if (!TAB_PATHS.includes(pathname)) return null;

  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={24} />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** The page body. Pads the bottom so the fixed tab bar never covers the last card. */
export function Screen({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <main className={`screen${TAB_PATHS.includes(pathname) ? ' screen--tabs' : ''}`}>
      {children}
    </main>
  );
}
