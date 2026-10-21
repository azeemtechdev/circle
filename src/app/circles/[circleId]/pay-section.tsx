'use client';

import { useState } from 'react';

import { ActionButton } from '@/components/action-button';
import { CopyButton } from '@/components/ui/copy-button';
import { Sheet } from '@/components/ui/sheet';
import { groupAccountNumber, type PayoutAccount } from '@/lib/payout';

/**
 * "You owe X" and the pay sheet.
 *
 * The bank transfer happens in the payer's bank app, outside Circle (PLAN.md
 * §2). The sheet's job is to make that transfer easy to get right — exact
 * amount, the recipient's account with a copy button, and a prompt to check
 * the name the bank shows — and then record the claim.
 *
 * "I've paid" is an ActionButton: one idempotency key per press-and-retries,
 * disabled while in flight, errors kept on screen.
 */
export function PaySection({
  contributionId,
  amount,
  recipientName,
  account,
  changedDaysAgo,
  openInitially,
}: {
  contributionId: string;
  amount: string;
  recipientName: string;
  account: PayoutAccount | null;
  /** Set when the details were edited within the warning window. */
  changedDaysAgo: number | null;
  openInitially: boolean;
}) {
  const [open, setOpen] = useState(openInitially);

  return (
    <>
      <div className="card">
        <b className="title">
          You owe {recipientName} {amount}
        </b>
        <p className="mute" style={{ marginBottom: 14 }}>
          Send it from your bank app, then tell us here.
        </p>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Pay {recipientName}
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="pay-title">
        <h2 id="pay-title">
          Pay {recipientName} {amount}
        </h2>
        <p className="mute">Send exactly this amount from your bank app.</p>

        {account ? (
          <>
            <div className="bank-box">
              <div className="row">
                <div className="kv" style={{ display: 'block' }}>
                  <small>Bank</small>
                  <b>{account.bank_name}</b>
                </div>
              </div>
              <div className="row">
                <div className="kv" style={{ display: 'block' }}>
                  <small>Account number</small>
                  <b style={{ letterSpacing: '0.04em' }}>
                    {groupAccountNumber(account.account_number)}
                  </b>
                </div>
                <CopyButton value={account.account_number} what="Account number" />
              </div>
              <div className="row">
                <div className="kv" style={{ display: 'block' }}>
                  <small>Account name</small>
                  <b>{account.account_name}</b>
                </div>
              </div>
            </div>
            {changedDaysAgo !== null ? (
              <p className="warn warn--bad" role="alert">
                {recipientName} changed these details{' '}
                {changedDaysAgo === 0
                  ? 'today'
                  : changedDaysAgo === 1
                    ? 'yesterday'
                    : `${changedDaysAgo} days ago`}
                . Check with {recipientName} directly — by phone, not in a message — before you pay.
              </p>
            ) : null}
            <p className="warn">
              Your bank app shows the account name before you send. Only pay if it says{' '}
              {account.account_name}.
            </p>
          </>
        ) : (
          <p className="warn">
            {recipientName} hasn’t added an account yet. Ask in your group for the account details.
          </p>
        )}

        <div style={{ marginTop: 18 }}>
          <ActionButton
            path="/api/circles/claim-contribution"
            body={{ contributionId }}
            label="I’ve paid"
            pendingLabel="Recording…"
            successMessage={`Marked as paid. ${recipientName} will confirm when it arrives.`}
            onDone={() => setOpen(false)}
          />
        </div>
        <button
          type="button"
          className="btn btn--outline"
          style={{ marginTop: 10 }}
          onClick={() => setOpen(false)}
        >
          Not yet
        </button>
      </Sheet>
    </>
  );
}

/**
 * The recipient's own share. Everyone pays in every round, the recipient
 * included (open_round, migration 0003), so the books only add up once this is
 * marked too — but there is nothing to transfer.
 */
export function OwnShareSection({ contributionId, amount }: { contributionId: string; amount: string }) {
  return (
    <div className="card">
      <b className="title">Your own share: {amount}</b>
      <p className="mute" style={{ marginBottom: 14 }}>
        Everyone pays into the pot, you too. There is nothing to send — mark it here, then confirm
        it in the list below like the others.
      </p>
      <ActionButton
        path="/api/circles/claim-contribution"
        body={{ contributionId }}
        label="Mark my share"
        pendingLabel="Recording…"
        successMessage="Your share is marked."
      />
    </div>
  );
}
