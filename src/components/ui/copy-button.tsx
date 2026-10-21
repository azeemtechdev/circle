'use client';

import { useState } from 'react';

import { Icon } from './icon';
import { useToast } from './toast';

/** Copies a value so nobody retypes an account number digit by digit. */
export function CopyButton({ value, what }: { value: string; what: string }) {
  const toast = useToast();
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFailed(false);
      toast(`${what} copied`);
    } catch {
      // Some Android WebViews refuse clipboard access. Say so; the number is
      // on screen to read.
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      className="copy-button"
      onClick={copy}
      aria-label={`Copy ${what.toLowerCase()}`}
    >
      <Icon name="copy" size={16} />
      {failed ? 'Copy failed' : 'Copy'}
    </button>
  );
}
