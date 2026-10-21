import Link from 'next/link';

import { BackLink } from '@/components/ui/back-link';

import { SignupForm } from './signup-form';

export default function SignupPage() {
  return (
    <>
      <div className="top-bar">
        <BackLink href="/" />
      </div>
      <div className="auth">
        <SignupForm />
        <p className="mute" style={{ textAlign: 'center', margin: '20px 0 0' }}>
          Have an account?{' '}
          <Link href="/login" className="link">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}
