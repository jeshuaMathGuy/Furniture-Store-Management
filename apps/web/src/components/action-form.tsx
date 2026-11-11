"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/server/action";

const idle: ActionResult = { ok: false };

/** Database rows the original triggers wrote during an action: the "observed" layer of a trace. */
export function EffectsPanel({ result }: { result: ActionResult }) {
  const e = result.effects;
  if (!e || (e.auditLog.length === 0 && e.statusHistory.length === 0)) return null;
  return (
    <div className="mt-3 rounded-xl border border-sage/50 bg-sage/10 p-3 text-xs" data-testid="effects-panel">
      <p className="font-medium text-sage-deep">Database effects observed (written by the original triggers)</p>
      <ul className="mt-2 space-y-1 font-mono">
        {e.statusHistory.map((h) => (
          <li key={`h${String(h.history_id)}`}>order_status_history + #{String(h.history_id)}: order {String(h.order_id)} → <b>{String(h.order_status)}</b> <span className="text-ink-soft">(au_sales_order)</span></li>
        ))}
        {e.auditLog.map((a) => (
          <li key={`a${String(a.audit_id)}`}>audit_log + #{String(a.audit_id)}: {String(a.entity_name)} {String(a.entity_key)} {String(a.event_type)}: {String(a.old_value)} → <b>{String(a.new_value)}</b> <span className="text-ink-soft">({a.entity_name === "product" ? "au_product" : "au_sales_order"})</span></li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-ink-soft">Rows written by any session while the action ran. On a busy shared server this could include other users&apos; changes.</p>
    </div>
  );
}

/**
 * Form bound to a Server Action, showing pending state, success or the
 * database's own rejection message, and any observed trigger effects.
 */
export function ActionForm({ action, children, submitLabel, pendingLabel = "Working…", className = "", buttonClass = "btn btn-primary h-10", testId, confirm, disabled = false }: {
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  buttonClass?: string;
  testId?: string;
  confirm?: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  return (
    <form action={formAction} className={className} data-testid={testId}
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}>
      {children}
      <button type="submit" className={buttonClass} disabled={pending || disabled}>{pending ? pendingLabel : submitLabel}</button>
      <div aria-live="polite">
        {state.error && <p role="alert" className="mt-2 rounded-lg bg-clay/12 px-3 py-2 text-sm text-clay-deep" data-testid="action-error">{state.error}</p>}
        {state.ok && state.message && <p className="mt-2 text-sm text-sage-deep" data-testid="action-ok">{state.message}</p>}
        <EffectsPanel result={state} />
      </div>
    </form>
  );
}
