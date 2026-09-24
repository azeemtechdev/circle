import Link from 'next/link';

import { CreateCircleForm } from './create-circle-form';

export default function NewCirclePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <div>
        <Link href="/dashboard" className="text-sm underline underline-offset-4 opacity-70">
          Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Start a circle</h1>
        <p className="mt-1 text-sm opacity-70">
          You can change nothing after it starts, so check the amount and the number of people.
        </p>
      </div>

      <CreateCircleForm />
    </main>
  );
}
