import Link from 'next/link';

import { SignupForm } from './signup-form';

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm opacity-70">
          Circle keeps the books for your ajo. No money passes through the app.
        </p>
      </div>

      <SignupForm />

      <p className="text-sm">
        Already have an account?{' '}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
