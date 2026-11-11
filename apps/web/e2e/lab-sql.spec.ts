import { open } from "./util";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD ?? "";
test.skip(!PASSWORD, "DEMO_ACCOUNT_PASSWORD must be provided");

async function signIn(page: Page, next: string) {
  await open(page, `/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill("student@furniform.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/\//g, "\\/") + "$"));
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
}

test("SQL playground runs a read-only query and rejects a write", async ({ page }) => {
  await signIn(page, "/lab/sql");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("sql-result")).toContainText("rows");
  await page.getByTestId("sql-editor").fill("UPDATE product SET list_price = 1");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("sql-error")).toContainText("Rejected before execution");
});

test("scenario run shows a validated trace with stepping", async ({ page }) => {
  await signIn(page, "/lab/procedures");
  await page.locator("[data-scenario='proc.confirm_order']").getByRole("button", { name: "Run" }).click();
  const player = page.getByTestId("trace-player");
  await expect(player.getByTestId("trace-status")).toHaveText("committed", { timeout: 20_000 });
  await expect(player.getByTestId("trace-validation")).toHaveText("Validated against MySQL");
  await expect(player.getByTestId("trace-changes")).toContainText("product_inventory [101]");
  await player.getByRole("button", { name: "Reset" }).click();
  await expect(player).toContainText("Before (no statement run yet)");
  await player.getByRole("button", { name: "Next" }).click();

  await page.locator("[data-scenario='proc.confirm_insufficient_stock']").getByRole("button", { name: "Run" }).click();
  await expect(player.getByTestId("trace-status")).toHaveText("failed", { timeout: 20_000 });
  await expect(player.getByTestId("trace-error")).toContainText("Insufficient inventory");
  await page.getByTestId("reset-sandbox").click();
  await expect(page.getByTestId("lab-message")).toContainText("Sandbox restored");
});

test("placeholder lab pages do not 404", async ({ page }) => {
  for (const p of ["/lab/schema", "/lab/views"]) expect((await open(page, p))?.status()).toBe(200);
});
