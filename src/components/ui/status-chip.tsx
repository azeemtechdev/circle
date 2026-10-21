import { chipClass, type Tone } from './status';

export function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={chipClass(tone)}>{children}</span>;
}
