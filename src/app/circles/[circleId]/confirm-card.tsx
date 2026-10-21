'use client';

import { useState } from 'react';

import { ActionButton } from '@/components/action-button';
import { Sheet } from '@/components/ui/sheet';
import { TimeAgo } from '@/components/ui/time-ago';

/**
 * A claimed payment, from the recipient's side: "Received" or "Not received".
 *
 * "Received" posts to the ledger, so it keeps the existing are-you-sure
 * prompt. "Not received" opens the dispute sheet. Disputes are Phase 6: no
 * transition can set a contribution to `disputed` yet, so the sheet explains
 * the situation and its button is disabled rather than pretending to do
 * something. No AI summary is shown — that is Phase 6 too, and a made-up one
 * would be worse than none.
 */
export function ConfirmCard({
  contributionId,
  payerName,
  amount,
  claimedAt,
  isOwnShare,
}: {
  contributionId: string;
  payerName: string;
  amount: string;
  claimedAt: string | null;
  isOwnShare: boolean;
}) {
  const [disputeOpen, setDisputeOpen] = useState(false);

  if (isOwnShare) {
    return (
      <div className="card">
        <b className="title">Your own share of {amount} is marked</b>
        <p className="mute" style={{ marginBottom: 14 }}>
          Confirm it to count it in the pot.
        </p>
        <ActionButton
          path="/api/circles/confirm-contribution"
          body={{ contributionId }}
          label="Confirm my share"
          pendingLabel="Confirming…"
          successMessage="Your share is confirmed."
        />
      </div>
    );
  }

  return (
    <div className="card">
      <b className="title">
        {payerName} says {amount} was sent
      </b>
      <p className="mute" style={{ marginBottom: 14 }}>
        Check your bank app before you confirm.
      </p>
      <div className="btn-row">
        <ActionButton
          path="/api/circles/confirm-contribution"
          body={{ contributionId }}
          label="Received"
          pendingLabel="Confirming…"
          small
          successMessage={`Confirmed. ${payerName} is paid up.`}
          confirm={`Confirm ${payerName} really sent you ${amount}. This records the money in the books and cannot be undone.`}
        />
        <button
          type="button"
          className="btn btn--danger btn--small"
          onClick={() => setDisputeOpen(true)}
        >
          Not received
        </button>
      </div>

      <Sheet open={disputeOpen} onClose={() => setDisputeOpen(false)} labelledBy="dispute-title">
        <h2 id="dispute-title">
          Didn’t get {amount} from {payerName}?
        </h2>
        <p>
          {payerName} marked {amount} as paid
          {claimedAt ? (
            <>
              {' '}
              (<TimeAgo iso={claimedAt} />)
            </>
          ) : null}
          . You haven’t confirmed it. Check your bank app again, including pending transfers.
        </p>

        <div className="card card--flush" style={{ background: 'var(--bg)', margin: '16px 0 0' }}>
          <b className="title" style={{ fontSize: 15 }}>
            Summary of the record
          </b>
          <p className="mute">
            Not available yet. In a later update Circle will write a neutral summary of this
            payment from the circle’s record.
          </p>
        </div>

        <p className="warn">
          Disputes arrive in a later update. For now, talk to {payerName} directly. Nothing is
          confirmed until you tap Received.
        </p>

        <button
          type="button"
          className="btn btn--danger"
          style={{ marginTop: 18 }}
          disabled
          aria-describedby="dispute-title"
        >
          Open a dispute — coming soon
        </button>
        <button
          type="button"
          className="btn btn--outline"
          style={{ marginTop: 10 }}
          onClick={() => setDisputeOpen(false)}
        >
          Go back
        </button>
      </Sheet>
    </div>
  );
}
