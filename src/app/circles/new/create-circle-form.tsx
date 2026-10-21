'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { callTransition, newIdempotencyKey, TransitionError } from '@/lib/http/client';
import { cadence, nairaClean, potNaira } from '@/lib/format';
import { koboFromNairaInput, koboToText } from '@/lib/money';

/**
 * Start a circle, in two steps: the details, then a check before creating.
 *
 * The design had a third step for reordering the payout order. There is no
 * transition that reorders memberships — a person's place is the position
 * they are invited at, and it locks on activation — so that step is left out
 * rather than faked. The creator is always first (migration 0009).
 *
 * Money: the amount is typed in naira and converted to exact kobo with
 * koboFromNairaInput (BigInt, no float). It travels as a string.
 */
const AMOUNTS = ['5000', '10000', '20000', '50000', '100000'];
const SIZES = [2, 3, 4, 5, 6, 8, 10, 12];
const PERIODS = [
  { days: 7, label: 'Weekly' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Monthly' },
];

export function CreateCircleForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [periodDays, setPeriodDays] = useState(30);
  const [memberTarget, setMemberTarget] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const keyRef = useRef<string | null>(null);
  // What the current key was made for. Going Back and pressing Continue with
  // the same details keeps the key: if the earlier attempt reached the server
  // but the answer was lost, a retry must replay it, not create a second circle.
  const keyForRef = useRef<string | null>(null);

  // Parsed for the preview only; the same parse runs again on submit.
  let amountKoboText: string | null = null;
  try {
    amountKoboText = amountInput ? koboToText(koboFromNairaInput(amountInput)) : null;
  } catch {
    amountKoboText = null;
  }

  function next(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Give the circle a name people will recognise.');
    try {
      const kobo = koboFromNairaInput(amountInput);
      if (kobo <= 0n) return setError('The amount must be more than ₦0.');
    } catch (cause) {
      return setError((cause as Error).message);
    }
    if (!Number.isInteger(memberTarget) || memberTarget < 2 || memberTarget > 50) {
      return setError('A circle needs between 2 and 50 people.');
    }
    // A changed form is a different circle: drop any key from an earlier try.
    const signature = JSON.stringify([name.trim(), amountInput.trim(), periodDays, memberTarget]);
    if (keyForRef.current !== signature) {
      keyRef.current = null;
      keyForRef.current = signature;
    }
    setStep(2);
  }

  async function create() {
    if (pending || !amountKoboText) return;

    // One key for this circle, reused if the request has to be retried.
    keyRef.current ??= newIdempotencyKey();
    setPending(true);
    setError(null);

    try {
      const id = await callTransition(
        '/api/circles/create-circle',
        { name: name.trim(), amountKobo: amountKoboText, periodDays, memberTarget },
        keyRef.current,
      );
      keyRef.current = null;
      keyForRef.current = null;
      router.push(`/circles/${id}`);
    } catch (cause) {
      setError(cause instanceof TransitionError ? cause.message : 'Something went wrong.');
      setPending(false);
    }
  }

  const header = (
    <>
      <div className="page-head">
        <h1>{step === 1 ? 'Start a circle' : 'Check and create'}</h1>
        <p className="mute" style={{ marginBottom: 0 }}>
          Step {step} of 2
        </p>
      </div>
      <div className="steps" aria-hidden="true">
        <i className="on" />
        <i className={step === 2 ? 'on' : ''} />
      </div>
    </>
  );

  if (step === 2 && amountKoboText) {
    return (
      <>
        {header}
        <div className="pad">
          <div className="card card--list card--flush" style={{ marginTop: 20 }}>
            {[
              ['Name', name.trim()],
              ['Each person pays', `${nairaClean(amountKoboText)} ${cadence(periodDays)}`],
              ['People', `${memberTarget}, including you`],
              ['Pot each round', potNaira(amountKoboText, memberTarget)],
              ['Rounds', `${memberTarget} — everyone receives once`],
              ['Your turn', 'Round 1'],
            ].map(([label, value]) => (
              <div className="row" key={label}>
                <span className="row__main mute" style={{ fontWeight: 500 }}>
                  {label}
                </span>
                <b style={{ textAlign: 'right' }}>{value}</b>
              </div>
            ))}
          </div>
          <p className="mute small" style={{ margin: '14px 0 0' }}>
            Nothing can be changed once the circle starts. Next you invite people by phone number.
            Money moves between members in their bank apps; Circle only keeps the record.
          </p>

          {error ? (
            <p role="alert" className="alert">
              {error}
            </p>
          ) : null}

          <div className="btn-row" style={{ marginTop: 24 }}>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setStep(1)}
              disabled={pending}
            >
              Back
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 2 }}
              onClick={create}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? 'Creating…' : 'Create circle'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <form className="pad" onSubmit={next}>
        <label className="field">
          <span>Circle name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Family ajo"
            required
          />
        </label>

        <span className="field-label" id="amount-label">
          Each person pays
        </span>
        <div className="choice-chips" role="group" aria-labelledby="amount-label">
          {AMOUNTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={amountInput === value}
              onClick={() => setAmountInput(value)}
            >
              {nairaClean(koboToText(koboFromNairaInput(value)))}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="visually-hidden">Or type an amount in naira</span>
          <input
            className="input"
            style={{ marginTop: 10 }}
            inputMode="decimal"
            placeholder="Or type an amount, e.g. 15000"
            value={AMOUNTS.includes(amountInput) ? '' : amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
          />
        </label>

        <span className="field-label" id="period-label">
          How often
        </span>
        <div className="choice-chips" role="group" aria-labelledby="period-label">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={periodDays === p.days}
              onClick={() => setPeriodDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <span className="field-label" id="size-label">
          People in the circle, including you
        </span>
        <div className="choice-chips" role="group" aria-labelledby="size-label">
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={memberTarget === n}
              onClick={() => setMemberTarget(n)}
            >
              {n}
            </button>
          ))}
        </div>

        {amountKoboText ? (
          <div className="card card--ok card--flush" style={{ marginTop: 22, fontWeight: 600 }}>
            Everyone pays in each round, including whoever receives. So the pot is{' '}
            {potNaira(amountKoboText, memberTarget)}, and the circle runs for {memberTarget} rounds.
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn" style={{ marginTop: 24 }}>
          Continue
        </button>
      </form>
    </>
  );
}
