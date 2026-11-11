import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-32 text-center sm:px-6">
      <p className="eyebrow">404</p>
      <h1 className="mt-4 text-5xl">This room is empty.</h1>
      <p className="mt-4 text-ink-soft">The page or piece you were looking for doesn&apos;t exist, or is no longer in the collection.</p>
      <Link href="/collection" className="btn btn-primary mt-8">Browse the collection</Link>
    </div>
  );
}
