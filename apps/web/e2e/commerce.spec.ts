import { expect, test, type Page } from "@playwright/test";
import { open } from "./util";

/**
 * Stage 4 end-to-end journey on the isolated e2e database (fresh per run):
 * customer checkout → staff fulfilment with visible trigger effects → review → loyalty,
 * plus the declined-payment rollback and the management screens.
 * Only customer 3 (Mira) buys here, so other specs' expectations about customers 1–2 hold.
 */
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD ?? "";
test.skip(!PASSWORD, "DEMO_ACCOUNT_PASSWORD must be provided");
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string, next = "/account") {
  await page.context().clearCookies();
  await open(page, `/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
}

let orderId = "";

test("customer adds to cart and checks out with an approved simulated payment", async ({ page }) => {
  await signIn(page, "mira.nair@example.com", "/collection/302");
  const add = page.getByTestId("add-to-cart");
  await add.locator("select[name=quantity]").selectOption("2");
  await add.getByRole("button", { name: /Add to cart/ }).click();
  await expect(page.getByTestId("cart-added")).toBeVisible();
  await expect(page.getByTestId("cart-count")).toHaveText("2");

  await open(page, "/cart");
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-total")).toContainText("19,600");
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
  await page.getByRole("button", { name: /Place order/ }).click();

  await page.waitForURL(/\/orders\/\d+\?placed=1/);
  orderId = /\/orders\/(\d+)/.exec(page.url())![1]!;
  await expect(page.getByTestId("order-placed")).toBeVisible();
  await expect(page.getByTestId("order-status")).toHaveText("Placed");
  await expect(page.getByTestId("order-history")).toContainText("Placed");
  await expect(page.getByTestId("order-payment")).toContainText("Authorized");
  await expect(page.getByTestId("cart-count")).toHaveCount(0);
});

test("a declined payment rolls the whole checkout back and keeps the cart", async ({ page }) => {
  await signIn(page, "mira.nair@example.com", "/collection/205");
  await page.getByTestId("add-to-cart").getByRole("button", { name: /Add to cart/ }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("1");
  await open(page, "/checkout");
  await page.getByLabel(/Decline/).check();
  await page.getByRole("button", { name: /Place order/ }).click();
  await expect(page.getByTestId("checkout-error")).toContainText("declined");
  await open(page, "/cart");
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
});

test("warehouse confirms, ships and delivers; trigger effects are shown for each step", async ({ page }) => {
  await signIn(page, "warehouse@furniform.local", `/orders/${orderId}`);
  await expect(page.getByTestId("staff-actions")).toBeVisible();

  await page.getByTestId("confirm-form").getByRole("button").click();
  await expect(page.getByTestId("effects-panel")).toContainText("confirmed");
  await expect(page.getByTestId("effects-panel")).toContainText("au_sales_order");
  await expect(page.getByTestId("order-status")).toHaveText("Confirmed");

  await page.getByTestId("ship-form").getByRole("button").click();
  await expect(page.getByTestId("order-status")).toHaveText("Shipped");
  await page.getByTestId("deliver-form").getByRole("button").click();
  await expect(page.getByTestId("order-status")).toHaveText("Delivered");
  await expect(page.getByTestId("order-payment")).toContainText("Captured");
  await expect(page.getByTestId("order-history")).toContainText("Delivered");
});

test("the customer reviews the delivered piece; admin awards loyalty points", async ({ page }) => {
  await signIn(page, "mira.nair@example.com", "/account");
  const card = page.locator("[data-testid=reviewable][data-product='302']");
  await card.getByLabel("4★").check();
  await card.locator("textarea").fill("Light and sturdy.");
  await card.getByRole("button", { name: "Publish review" }).click();
  await expect(card).toContainText("Light and sturdy.");

  await signIn(page, "admin@furniform.local", "/manage/finance");
  await page.getByTestId("loyalty-form").getByRole("button").click();
  await expect(page.getByTestId("loyalty-form").getByTestId("action-ok")).toContainText("sp_award_loyalty awarded");

  await signIn(page, "mira.nair@example.com", "/account");
  await expect(page.getByTestId("loyalty-points")).toHaveText("566"); // 370 from order 5003 (original data) + FLOOR(19600 / 100)
});

test("admin price change is audited by au_product and shown as an observed effect", async ({ page }) => {
  await signIn(page, "admin@furniform.local", "/manage/catalog");
  const row = page.locator("[data-testid=catalog-table] tr[data-product='405']");
  await row.locator("input[name=price]").fill("46500");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByTestId("effects-panel")).toContainText("au_product");
  await expect(row.getByTestId("effects-panel")).toContainText("46500.00");
  await open(page, "/manage/audit");
  await expect(page.getByTestId("audit-table")).toContainText("46500.00");
});

test("warehouse creates and posts a goods receipt through sp_receive_goods", async ({ page }) => {
  await signIn(page, "warehouse@furniform.local", "/manage/inventory");
  const before = Number(await page.locator("[data-testid=inventory-table] tr[data-product='302'] [data-testid=qty-on-hand]").innerText().then((t) => t.replace(/\D.*/, "")));
  const form = page.getByTestId("receipt-form");
  await form.locator("select[name=product0]").selectOption("302");
  await form.locator("input[name=qty0]").fill("4");
  await form.getByRole("button", { name: "Create pending receipt" }).click();
  await expect(form.getByTestId("action-ok")).toContainText("created (pending)");
  const pending = page.locator("[data-testid=receipts] li[data-status='pending']").first();
  await pending.getByTestId("post-receipt").getByRole("button").click();
  await expect(page.locator("[data-testid=inventory-table] tr[data-product='302'] [data-testid=qty-on-hand]")).toContainText(String(before + 4));
});

test("supplier portal is scoped to the supplier's own data", async ({ page }) => {
  await signIn(page, "cedarworks@furniform.local", "/manage");
  await expect(page).toHaveURL(/\/manage\/supplier$/);
  await expect(page.getByTestId("supplier-portal")).toContainText("CedarWorks");
  await expect(page.getByTestId("supplier-products")).toContainText("Oak Executive Desk");
  await expect(page.getByTestId("supplier-products")).not.toContainText("Modular Fabric Sofa");
  const res = await open(page, "/manage/catalog");
  expect(res?.status()).toBe(404);
});
