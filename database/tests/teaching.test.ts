import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Conn } from "../../packages/database/src/connection.js";
import { TEACHING_TEMP_TABLES } from "../../packages/database/src/runner.js";
import { q, testCfg } from "./helpers.js";

/**
 * Required test 3: persisted normalization snapshots reconstruct the source
 * instances. These are DATA-INSTANCE checks on the sample; structural (FD/MVD)
 * arguments are documented separately in docs/normalization.
 */
const cfg = testCfg();
const T = cfg.TEACHING_DB_NAME;
let r: Conn;
beforeAll(async () => { r = await connect(cfg, "lab_reader", T); });
afterAll(async () => { await r?.end(); });

const n = async (sql: string) => Number((await q(r, sql))[0]!.n);

describe("teaching snapshots exist and are readable by the lab reader", () => {
  it("all 14 session relations and 20 pre-demo base relations were persisted", async () => {
    const rows = await q(r, "SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    const names = rows.map((x) => x.t);
    for (const t of TEACHING_TEMP_TABLES) expect(names).toContain(t);
    expect(names.filter((x) => x.startsWith("base_"))).toHaveLength(20);
  });
  it("row counts per stage", async () => {
    expect(await n("SELECT COUNT(*) n FROM unf_sales_order")).toBe(3);
    expect(await n("SELECT COUNT(*) n FROM nf1_order_line")).toBe(4);
    expect(await n("SELECT COUNT(*) n FROM nf1_supplier_capability")).toBe(8);
    expect(await n("SELECT COUNT(*) n FROM nf3_order_supplier_plan")).toBe(3);
    expect(await n("SELECT COUNT(*) n FROM base_sales_order")).toBe(3); // before order 5004 existed
  });
});

describe("lossless reconstruction on the pre-demo snapshot", () => {
  it("UNF → 1NF: JSON items expand to exactly the 1NF rows", async () => {
    expect(await n(`SELECT COUNT(*) n FROM unf_sales_order o
      CROSS JOIN JSON_TABLE(o.items,'$[*]' COLUMNS (product_id INT PATH '$.product_id', quantity INT PATH '$.quantity')) j
      LEFT JOIN nf1_order_line l ON l.order_id=o.order_id AND l.product_id=j.product_id
      WHERE l.order_id IS NULL OR l.quantity<>j.quantity`)).toBe(0);
  });
  it("2NF → 3NF orders: 0 violations against the checkpoint (contrast with audit F2's 1)", async () => {
    expect(await n(`SELECT COUNT(*) n FROM nf2_order x
      LEFT JOIN base_sales_order o ON o.order_id=x.order_id
      LEFT JOIN base_customer c ON c.customer_id=o.customer_id
      LEFT JOIN base_postal_area a ON a.postal_code=c.postal_code
      WHERE o.order_id IS NULL OR c.customer_id IS NULL OR a.postal_code IS NULL
         OR x.order_status<>o.order_status OR x.customer_email<>c.email OR x.city<>a.city OR x.region<>a.region`)).toBe(0);
  });
  it("3NF → BCNF: order_plan ⋈ warranty_plan equals the original relation exactly (no missing, no spurious)", async () => {
    const joined = await q(r, `SELECT op.order_id, w.supplier_id, op.plan_code FROM base_order_plan op
      JOIN base_warranty_plan w ON w.plan_code=op.plan_code ORDER BY 1,2,3`);
    const original = await q(r, "SELECT order_id, supplier_id, plan_code FROM nf3_order_supplier_plan ORDER BY 1,2,3");
    expect(joined).toEqual(original);
  });
  it("BCNF precondition on the sample: plan_code → supplier_id holds", async () => {
    expect(await n(`SELECT COUNT(*) n FROM (SELECT plan_code FROM nf3_order_supplier_plan GROUP BY plan_code
      HAVING COUNT(DISTINCT supplier_id)>1) v`)).toBe(0);
  });
  it("BCNF → 4NF: certification × region per supplier reproduces the capability relation exactly", async () => {
    const joined = await q(r, `SELECT c.supplier_id, c.certification, s.service_region
      FROM base_supplier_certification c JOIN base_supplier_service_region s ON s.supplier_id=c.supplier_id ORDER BY 1,2,3`);
    const original = await q(r, "SELECT supplier_id, certification, service_region FROM nf3_supplier_capability ORDER BY 1,2,3");
    expect(joined).toEqual(original);
  });
});
