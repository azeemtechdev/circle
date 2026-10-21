import type { RoundContribution } from '@/lib/circles/queries';

/**
 * One meaning per colour, everywhere: green paid, amber waiting, red owes.
 * `disputed` is red too — money is in question until someone resolves it.
 */
export type Tone = 'ok' | 'wait' | 'bad' | 'neutral';

export const CONTRIBUTION_TONE: Record<RoundContribution['status'], Tone> = {
  pending: 'bad',
  claimed: 'wait',
  confirmed: 'ok',
  disputed: 'bad',
};

export const CONTRIBUTION_CHIP: Record<RoundContribution['status'], string> = {
  pending: 'Not paid',
  claimed: 'Waiting',
  confirmed: 'Confirmed',
  disputed: 'Disputed',
};

export function chipClass(tone: Tone): string {
  return tone === 'neutral' ? 'chip' : `chip chip--${tone}`;
}

export function dotClass(tone: Tone): string {
  return tone === 'neutral' ? 'dot' : `dot dot--${tone}`;
}
