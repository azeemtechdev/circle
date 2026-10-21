import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Logo } from '@/components/ui/logo';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Someone already signed in has no use for the pitch.
  if (user) redirect('/dashboard');

  return (
    <div className="welcome">
      <Logo />
      <div className="welcome__art">
        <RotationArt />
      </div>
      <h1>Ajo and esusu, with books that keep themselves.</h1>
      <p style={{ opacity: 0.8, margin: '12px 0 22px' }}>
        Everyone sees who has paid, whose turn it is, and what is owed.
      </p>
      <div className="stack-12">
        <Link href="/signup" className="btn btn--lime">
          Create an account
        </Link>
        <Link href="/login" className="btn btn--ghost">
          Sign in
        </Link>
      </div>
      <p className="fine-print">
        Money moves between you in your bank app. Circle never touches it. It only keeps the
        record.
      </p>
    </div>
  );
}

/**
 * Six seats around a ring, one of them taking its turn. Illustrative only — no
 * names or amounts, so it never reads as somebody's real circle.
 */
function RotationArt() {
  const seats = Array.from({ length: 6 }, (_, i) => {
    const angle = ((-90 + i * 60) * Math.PI) / 180;
    return { x: 120 + 84 * Math.cos(angle), y: 120 + 84 * Math.sin(angle), turn: i === 2 };
  });
  const fills = ['#D7F0E3', '#FCE3C8', '#BDF26D', '#DDE4FB', '#F9DDE8', '#EBE0F8'];

  return (
    <svg
      viewBox="0 0 240 240"
      style={{ width: '100%', maxWidth: 260 }}
      role="img"
      aria-label="Six people seated around a circle; one of them is taking their turn to receive"
    >
      <circle
        cx="120"
        cy="120"
        r="84"
        fill="none"
        stroke="#fff"
        strokeOpacity=".25"
        strokeWidth="1.5"
        strokeDasharray="2 7"
        strokeLinecap="round"
      />
      {seats.map((seat, i) => (
        <circle
          key={i}
          cx={seat.x.toFixed(1)}
          cy={seat.y.toFixed(1)}
          r={seat.turn ? 25 : 20}
          fill={fills[i]}
          stroke={seat.turn ? '#fff' : 'none'}
          strokeOpacity=".3"
          strokeWidth="6"
        />
      ))}
      <text x="120" y="114" textAnchor="middle" fontSize="13" fill="#fff" fillOpacity=".75">
        One pot,
      </text>
      <text x="120" y="136" textAnchor="middle" fontSize="18" fontWeight="800" fill="#fff">
        everyone&apos;s turn
      </text>
    </svg>
  );
}
