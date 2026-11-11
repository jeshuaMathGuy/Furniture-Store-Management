"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1.5 block text-sm">Email</span>
        <input className="field" name="email" type="email" autoComplete="username" required defaultValue={state.email}
          aria-invalid={!!state.error} aria-describedby={state.error ? "login-error" : undefined} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm">Password</span>
        <input className="field" name="password" type="password" autoComplete="current-password" required
          aria-invalid={!!state.error} aria-describedby={state.error ? "login-error" : undefined} />
      </label>
      {state.error && (
        <p id="login-error" role="alert" className="rounded-lg bg-clay/12 px-3 py-2 text-sm text-clay-deep">{state.error}</p>
      )}
      <button className="btn btn-primary w-full" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
