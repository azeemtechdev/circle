import Link from 'next/link';

import { Icon } from './icon';

/** The round back button at the top of a screen without a tab bar. */
export function BackLink({ href, onHero = false }: { href: string; onHero?: boolean }) {
  return (
    <Link href={href} className={onHero ? 'round-button' : 'back-button'} aria-label="Back">
      <Icon name="back" />
    </Link>
  );
}
