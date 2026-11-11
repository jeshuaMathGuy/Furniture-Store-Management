const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** DECIMAL values arrive from MySQL as exact strings. They are only converted to numbers for display. */
export function formatPrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return inr.format(Number(value));
}

export function formatDate(value: string): string {
  const d = new Date(value.replace(" ", "T") + (value.length <= 10 ? "T00:00:00Z" : "Z"));
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const titleCase = (s: string) => s.replace(/(^|[\s_-])(\w)/g, (_m, sep: string, c: string) => (sep === "_" || sep === "-" ? " " : sep) + c.toUpperCase());
