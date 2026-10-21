'use client';

import { useActionState, useState } from 'react';

import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state';
import { savePayoutAccount } from '@/lib/auth/payout-actions';
import { NIGERIAN_BANKS } from '@/lib/payout';

const OTHER = '__other__';

/**
 * Where you want to be paid (migration 0010).
 *
 * Shown to the people who owe you, on their pay screen, when it is your turn.
 * Validation is enforced in SQL; the hints here only save a round trip.
 */
export function PayoutForm({
  bankName: initialBank,
  accountNumber: initialNumber,
  accountName: initialName,
}: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}) {
  const [state, action, pending] = useActionState(savePayoutAccount, EMPTY_AUTH_STATE);
  const known = (NIGERIAN_BANKS as readonly string[]).includes(initialBank);
  const [bankChoice, setBankChoice] = useState(initialBank === '' ? '' : known ? initialBank : OTHER);
  const [otherBank, setOtherBank] = useState(known ? '' : initialBank);
  const [accountNumber, setAccountNumber] = useState(initialNumber);
  const [accountName, setAccountName] = useState(initialName);

  const bankName = bankChoice === OTHER ? otherBank : bankChoice;

  return (
    <form action={action} style={{ paddingBottom: 6 }}>
      <input type="hidden" name="bankName" value={bankName} />

      <label className="field">
        <span>Bank</span>
        <select
          className="input"
          value={bankChoice}
          onChange={(e) => setBankChoice(e.target.value)}
          required
        >
          <option value="" disabled>
            Choose your bank
          </option>
          {NIGERIAN_BANKS.map((bank) => (
            <option key={bank} value={bank}>
              {bank}
            </option>
          ))}
          <option value={OTHER}>Other</option>
        </select>
      </label>

      {bankChoice === OTHER ? (
        <label className="field">
          <span>Bank name</span>
          <input
            className="input"
            value={otherBank}
            onChange={(e) => setOtherBank(e.target.value)}
            required
            maxLength={80}
          />
        </label>
      ) : null}

      <label className="field">
        <span>Account number</span>
        <input
          className="input input--mono"
          name="accountNumber"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9 ]{10,13}"
          placeholder="10 digits"
          required
        />
      </label>

      <label className="field">
        <span>Name on the account</span>
        <input
          className="input"
          name="accountName"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          autoComplete="name"
          maxLength={100}
          required
        />
        <small>
          Exactly as your bank shows it. Payers are told to check it matches before they send.
        </small>
      </label>

      <p className="warn" style={{ marginTop: 14 }}>
        Only people who have joined a circle with you can see these. Changing them later shows a
        warning to the people who owe you.
      </p>

      {state.error ? (
        <p role="alert" className="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="notice">
          {state.notice}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={pending} style={{ marginTop: 16 }}>
        {pending ? 'Saving…' : 'Save account'}
      </button>
    </form>
  );
}
