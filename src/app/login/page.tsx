import Link from 'next/link';

import { BackLink } from '@/components/ui/back-link';

import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Async since Next 15.
  const params = await searchParams;
  const raw = params['next'];
  const next = typeof raw === 'string' ? raw : '/dashboard';

  return (
    <>
      <div className="top-bar">
        <BackLink href="/" />
      </div>
      <div className="auth">
        <h1>Welcome back</h1>
        <p className="mute" style={{ margin: '8px 0 0' }}>
          Sign in to see your circles.
        </p>

        <LoginForm next={next} />

        <p className="mute" style={{ textAlign: 'center', margin: '20px 0 0' }}>
          New here?{' '}
          <Link href="/signup" className="link">
            Create an account
          </Link>
        </p>
      </div>
    </>
  );
}
