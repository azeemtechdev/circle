import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Someone already signed in has no use for the pitch.
  if (user) redirect('/dashboard');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Circle</h1>
        <p className="mt-2 text-base opacity-80">
          Ajo and esusu, with books that keep themselves. Everyone can see who has paid, whose turn
          it is, and what is owed.
        </p>
        <p className="mt-2 text-sm opacity-70">
          Money moves between you in your bank app, exactly as it always has. Circle never touches
          it — it only keeps the record.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-foreground px-4 py-3 text-center text-base font-medium text-background"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-black/20 px-4 py-3 text-center text-base font-medium dark:border-white/25"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
