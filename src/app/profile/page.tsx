import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { ProfileForm } from './profile-form';

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, phone')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <div>
        <Link href="/dashboard" className="text-sm underline underline-offset-4 opacity-70">
          Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Your details</h1>
      </div>

      <ProfileForm displayName={profile?.display_name ?? ''} phone={profile?.phone ?? ''} />
    </main>
  );
}
