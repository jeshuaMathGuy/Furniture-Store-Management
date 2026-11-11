export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the collection…</span>
      <div className="h-4 w-32 animate-pulse rounded bg-limestone" />
      <div className="mt-4 h-14 w-2/3 animate-pulse rounded bg-limestone" />
      <ul className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <div className="aspect-[4/3] animate-pulse rounded-2xl bg-limestone" />
            <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-limestone" />
          </li>
        ))}
      </ul>
    </div>
  );
}
