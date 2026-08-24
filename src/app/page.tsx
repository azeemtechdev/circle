export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Circle</h1>
      <p className="max-w-md text-lg text-black/70 dark:text-white/70">
        Savings circles (ajo / esusu) that keep their own books.
      </p>
      <p className="rounded-full border border-black/10 px-4 py-1.5 font-mono text-sm text-black/60 dark:border-white/15 dark:text-white/60">
        Phase 0 — skeleton &amp; guardrails
      </p>
    </main>
  );
}
