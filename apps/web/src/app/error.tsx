"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-3xl px-4 py-32 text-center sm:px-6">
      <p className="eyebrow">Something gave way</p>
      <h1 className="mt-4 text-5xl">We couldn&apos;t load this page.</h1>
      <p className="mt-4 text-ink-soft">
        The server reported an error{error.digest ? ` (reference ${error.digest})` : ""}. If the database is still starting, wait a moment and try again.
      </p>
      <button onClick={reset} className="btn btn-primary mt-8" type="button">Try again</button>
    </div>
  );
}
