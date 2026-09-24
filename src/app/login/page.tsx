import Link from 'next/link';

import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Async since Next 15.
  const params = await searchParams;
  const raw = params['next'];
  const next = typeof raw === 'string' ? raw : '/dashboard';

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm opacity-70">Welcome back to your circle.</p>
      </div>

      <LoginForm next={next} />

      <p className="text-sm">
        No account yet?{' '}
        <Link href="/signup" className="underline underline-offset-4">
          Create one
        </Link>
      </p>
    </main>
  );
}
