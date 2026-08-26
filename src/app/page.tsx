import { AuthScreen } from '@/components/auth-screen';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Circle</h1>
        <p className="max-w-md text-lg text-black/70 dark:text-white/70">
          Savings circles (ajo / esusu) that keep their own books.
        </p>
      </div>

      <AuthScreen />
    </main>
  );
}
