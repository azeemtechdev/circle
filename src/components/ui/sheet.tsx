'use client';

import { useEffect, useRef } from 'react';

/**
 * A bottom sheet, built on the native <dialog>.
 *
 * showModal() gives focus trapping, Escape to close and an inert page behind
 * it with no code here; a hand-rolled overlay tends to get one of the three
 * wrong on some Android browser. Tapping the dimmed area closes it too.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        // The dialog element itself only receives the click when the backdrop
        // was hit; anything inside the sheet has a more specific target.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
