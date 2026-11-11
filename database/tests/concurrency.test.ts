import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Conn } from "../../packages/database/src/connection.js";
import { receiveGoods } from "../../packages/database/src/repositories/inventory.js";
import { DomainError } from "../../packages/database/src/errors.js";
import { ctxWith, q, scratchDb } from "./helpers.js";

let db: Awaited<ReturnType<typeof scratchDb>>;
beforeAll(async () => { db = await scratchDb("concurrency"); });
afterAll(async () => { await db?.dispose(); });

const inv = async (id: number) => Number((await q(db.conn, "SELECT qty_on_hand FROM product_inventory WHERE product_id=?", [id]))[0]!.qty_on_hand);

async function waitForLockWaits(n: number, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    // performance_schema is live; information_schema.INNODB_TRX is a cache that stays stale under frequent polling.
    const [r] = await q(db.conn, "SELECT COUNT(DISTINCT REQUESTING_ENGINE_TRANSACTION_ID) n FROM performance_schema.data_lock_waits");
    if (Number(r!.n) >= n) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  const trx = await q(db.conn, "SELECT trx_state, trx_query FROM information_schema.INNODB_TRX");
  const procs = await q(db.conn, "SELECT STATE, INFO FROM information_schema.PROCESSLIST WHERE DB=DATABASE()");
  throw new Error(`Timed out waiting for ${n} lock-waiting transactions: ${JSON.stringify({ trx, procs })}`);
}

/** Session X holds the inventory row so both posters reach the blocking UPDATE before either commits. */
async function holdInventoryRow(productId: number): Promise<Conn> {
  const x = await connect(db.cfg, "root", db.dbName);
  await x.query("START TRANSACTION");
  await x.query("SELECT qty_on_hand FROM product_inventory WHERE product_id=? FOR UPDATE", [productId]);
  return x;
}

async function newReceipt(id: number, productId: number, qty: number) {
  await db.conn.query("INSERT INTO goods_receipt VALUES (?, '2026-11-08', 'pending')", [id]);
  await db.conn.query("INSERT INTO goods_receipt_line VALUES (?, ?, ?)", [id, productId, qty]);
}

describe("audit finding F1: concurrent posting of one receipt", () => {
  it("CHARACTERIZATION: the original sp_receive_goods double-posts under concurrency", async () => {
    await newReceipt(7100, 202, 5);
    const start = await inv(202);
    const x = await holdInventoryRow(202);
    const a = await connect(db.cfg, "root", db.dbName);
    const b = await connect(db.cfg, "root", db.dbName);
    try {
      const pa = a.query("CALL sp_receive_goods(7100)");
      const pb = b.query("CALL sp_receive_goods(7100)");
      await waitForLockWaits(2); // both passed the non-locking 'pending' check
      await x.query("COMMIT");
      const results = await Promise.allSettled([pa, pb]);
      // Both calls report success...
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      // ...and the 5 received units were added twice.
      expect(await inv(202)).toBe(start + 10);
      expect((await q(db.conn, "SELECT receipt_status s FROM goods_receipt WHERE receipt_id=7100"))[0]!.s).toBe("posted");
    } finally {
      await Promise.all([x.end(), a.end(), b.end()]);
    }
  });

  it("MITIGATION: the service-level named lock serialises callers, so the second is rejected", async () => {
    await newReceipt(7101, 201, 4);
    const start = await inv(201);
    const x = await holdInventoryRow(201);
    const warehouse = ctxWith(["warehouse"]);
    try {
      const pa = receiveGoods(db.pool, warehouse, 7101);
      await waitForLockWaits(1); // A holds the named lock and is inside the procedure
      const pb = receiveGoods(db.pool, warehouse, 7101); // B now waits on GET_LOCK
      await new Promise((r) => setTimeout(r, 300));
      await x.query("COMMIT");
      const [ra, rb] = await Promise.allSettled([pa, pb]);
      expect(ra.status).toBe("fulfilled");
      expect(rb.status).toBe("rejected");
      const err = (rb as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(DomainError);
      expect(err.message).toContain("already been posted");
      expect(await inv(201)).toBe(start + 4);
    } finally {
      await x.end();
    }
  });
});

describe("locking reads (transaction lab groundwork)", () => {
  it("SELECT ... FOR UPDATE blocks a second writer until commit; the timeout is bounded", async () => {
    const x = await holdInventoryRow(101);
    const y = await connect(db.cfg, "root", db.dbName);
    try {
      await y.query("SET SESSION innodb_lock_wait_timeout = 1");
      await expect(y.query("UPDATE product_inventory SET qty_on_hand=qty_on_hand WHERE product_id=101"))
        .rejects.toMatchObject({ code: "ER_LOCK_WAIT_TIMEOUT" });
      await x.query("ROLLBACK");
      await y.query("UPDATE product_inventory SET qty_on_hand=qty_on_hand WHERE product_id=101");
    } finally {
      await Promise.all([x.end(), y.end()]);
    }
  });
  it("REPEATABLE READ: a consistent read does not see another session's later commit", async () => {
    const r = await connect(db.cfg, "root", db.dbName);
    try {
      await r.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await r.query("START TRANSACTION");
      const before = Number((await q(r, "SELECT qty_on_hand FROM product_inventory WHERE product_id=202"))[0]!.qty_on_hand);
      await db.conn.query("UPDATE product_inventory SET qty_on_hand=qty_on_hand+1 WHERE product_id=202");
      const again = Number((await q(r, "SELECT qty_on_hand FROM product_inventory WHERE product_id=202"))[0]!.qty_on_hand);
      const current = Number((await q(r, "SELECT qty_on_hand FROM product_inventory WHERE product_id=202 FOR SHARE"))[0]!.qty_on_hand);
      await r.query("COMMIT");
      expect(again).toBe(before);
      expect(current).toBe(before + 1);
    } finally {
      await r.end();
    }
  });
});
