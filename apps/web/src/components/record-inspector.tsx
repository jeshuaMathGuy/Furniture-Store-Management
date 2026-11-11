import type { records } from "@furni/database";

const cell = (v: unknown) => (v === null || v === undefined ? <span className="text-ink-soft/60">NULL</span> : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Raw relational rows behind a storefront page. Rendered only for administrators and lab roles (checked on the server). */
export function RecordInspector({ productId, tables }: { productId: number; tables: records.RecordTable[] }) {
  return (
    <details className="group rounded-3xl bg-charcoal text-porcelain" data-testid="record-inspector">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="eyebrow !text-oat">Beyond the surface</span>
          <span id="record" className="mt-1 block font-display text-2xl">Inspect the records behind product {productId}</span>
        </span>
        <span aria-hidden className="text-2xl transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-8 border-t border-porcelain/10 px-6 pb-8 pt-6">
        <p className="max-w-2xl text-sm text-oat">
          These are the actual rows in the store database, read with the application&apos;s
          least-privilege database user. Tables marked &quot;original&quot; come from the source SQL; &quot;extension&quot; tables were added by FURNI / FORM migrations.
        </p>
        {tables.map((t) => (
          <div key={t.table}>
            <p className="font-mono text-sm">
              {t.table} <span className="text-oat/70">· {t.note} · {t.rows.length} row{t.rows.length === 1 ? "" : "s"}</span>
            </p>
            {t.rows.length > 0 && (
              <div className="mt-2 overflow-x-auto rounded-xl border border-porcelain/10">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-porcelain/5 text-oat">
                    <tr>{Object.keys(t.rows[0]!).map((c) => <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 font-normal">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r, i) => (
                      <tr key={i} className="border-t border-porcelain/10">
                        {Object.values(r).map((v, j) => <td key={j} className="whitespace-nowrap px-3 py-2">{cell(v)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
