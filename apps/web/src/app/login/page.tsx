import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, safeNext } from "@/lib/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <div className="mx-auto grid max-w-5xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-10">
      <div>
        <p className="eyebrow">Account</p>
        <h1 className="mt-4 text-5xl leading-tight">Welcome back to the studio.</h1>
        <p className="mt-5 text-ink-soft">
          One sign-in for customers, administrators, warehouse operators, suppliers and students. What you see afterwards depends on your role,
          and every permission is checked on the server.
        </p>
        <p className="mt-6 text-sm text-ink-soft">
          Local demonstration accounts are listed in <code className="font-mono text-xs">docs/database/ROLES_AND_ACCOUNTS.md</code>.
        </p>
      </div>
      <div className="rounded-3xl border hairline bg-white/50 p-8 shadow-soft">
        <LoginForm next={next} />
      </div>
    </div>
  );
}
