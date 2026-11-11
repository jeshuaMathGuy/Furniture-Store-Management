import type { RelationSchema, Row } from "@furni/database/src/lab/normalization";
import { formatCell, rowGroupKey, tint, type Highlight } from "./shared";

export type CardState = "present" | "dim" | "entering";

interface Props {
  schema: RelationSchema;
  rows: Row[];
  keys: string[][];
  highlight?: Map<string, Highlight>;
  /** Tint of the card heading (the violation this relation was split out for). */
  headTint?: number | null;
  state: CardState;
  rowsVisible: boolean;
  /** Tint rows by order / supplier so the eye can follow them between relations (1NF). */
  groupTints?: Map<string, number>;
  /** Show JSON arrays as item chips (1NF unnesting). */
  expandJson?: boolean;
  badge?: string;
}

const STATE_CLASS: Record<CardState, string> = {
  present: "opacity-100 translate-y-0",
  dim: "opacity-45 saturate-50",
  entering: "opacity-100 translate-y-0 animate-[nf-enter_640ms_var(--ease-arch)_both]",
};

function JsonCell({ value, group, groupTints }: { value: unknown; group: string; groupTints?: Map<string, number> }) {
  const items = Array.isArray(value) ? value : [];
  const t = groupTints?.get(group);
  return (
    <ul className="flex flex-wrap gap-1" aria-label={`${items.length} array element${items.length === 1 ? "" : "s"}`}>
      {items.map((it, i) => {
        const o = (typeof it === "object" && it ? it : null) as Record<string, unknown> | null;
        const text = o ? `${String(o.product_id)} ×${String(o.quantity)} · ${String(o.plan_code)}` : String(it);
        return (
          <li key={i} className={`whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[0.68rem] ring-1 ring-inset ${t !== undefined ? `${tint(t).cell} ${tint(t).ring}` : "bg-white/60 ring-charcoal/15"}`}>
            {text}
          </li>
        );
      })}
    </ul>
  );
}

export function RelationCard({ schema, rows, keys, highlight, headTint, state, rowsVisible, groupTints, expandJson, badge }: Props) {
  const prime = new Set(keys.flat());
  const primary = keys[0] ?? [];
  const headClass = headTint === null || headTint === undefined ? "bg-limestone text-charcoal" : tint(headTint).head;
  return (
    <figure
      data-testid="relation-card" data-relation={schema.name}
      className={`min-w-0 overflow-hidden rounded-2xl border hairline bg-white/55 shadow-soft transition-[opacity,transform,filter] duration-700 ease-[var(--ease-arch)] ${STATE_CLASS[state]}`}
    >
      <figcaption className={`flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 ${headClass}`}>
        <span className="font-mono text-[0.82rem] font-medium">{schema.name}</span>
        <span className="flex items-center gap-2 text-[0.68rem] uppercase tracking-wider opacity-80">
          {badge && <span>{badge}</span>}
          <span>{rows.length} row{rows.length === 1 ? "" : "s"}</span>
        </span>
      </figcaption>
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse text-left text-[0.72rem]">
          <caption className="sr-only">
            {schema.name}: {schema.description} Key{keys.length > 1 ? "s" : ""}: {keys.map((k) => `(${k.join(", ")})`).join(" and ")}.
          </caption>
          <thead>
            <tr>
              {schema.attributes.map((a) => {
                const h = highlight?.get(a);
                const cls = h ? (h.role === "determinant" ? `${tint(h.tint).head} ring-2 ring-inset ${tint(h.tint).ring}` : tint(h.tint).head) : "bg-porcelain/70";
                return (
                  <th key={a} scope="col" data-attr={a} data-highlight={h?.role}
                    className={`whitespace-nowrap border-b hairline px-2 py-1.5 font-mono font-medium transition-colors duration-500 ${cls}`}>
                    <span className={primary.includes(a) ? "underline decoration-2 underline-offset-2" : prime.has(a) ? "underline decoration-dotted underline-offset-2" : ""}>{a}</span>
                    {h?.role === "nonatomic" && <span className="ml-1 text-[0.6rem] uppercase">json</span>}
                    {h && <span className="sr-only"> ({h.role === "determinant" ? "determinant" : h.role === "nonatomic" ? "not atomic" : "dependent"})</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const g = rowGroupKey(r);
              const gt = groupTints?.get(g);
              return (
                <tr key={i} data-row
                  style={{ transitionDelay: rowsVisible ? `${Math.min(i, 12) * 70}ms` : "0ms" }}
                  className={`border-b hairline transition-[opacity,transform] duration-500 ease-[var(--ease-arch)] last:border-0 ${rowsVisible ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"} ${gt !== undefined ? tint(gt).cell : ""}`}>
                  {schema.attributes.map((a) => {
                    const h = highlight?.get(a);
                    const v = r[a];
                    return (
                      <td key={a} className={`whitespace-nowrap px-2 py-1 align-top font-mono transition-colors duration-500 ${h && h.role !== "determinant" && gt === undefined ? tint(h.tint).cell : ""}`}>
                        {expandJson && Array.isArray(v) ? <JsonCell value={v} group={g} groupTints={groupTints} /> : formatCell(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
