import { open } from "./util";
import { expect, test, type Page } from "@playwright/test";

// Local-only demo password, read from the project's .env (never hard-coded here).
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD ?? "";
test.skip(!PASSWORD, "DEMO_ACCOUNT_PASSWORD must be provided to run auth tests");

async function signIn(page: Page, email: string, next?: string) {
  await open(page, next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("wrong password shows an accessible error and no session", async ({ page }) => {
  await open(page, "/login");
  await page.getByLabel("Email").fill("dev.shah@example.com");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toContainText("don't match");
  await expect(page.locator("#login-error")).toHaveAttribute("role", "alert");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("account requires sign-in and returns there afterwards", async ({ page }) => {
  await open(page, "/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  await page.getByLabel("Email").fill("asha.rao@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("customer sees only their own orders and no internal tools", async ({ page, context }) => {
  await signIn(page, "asha.rao@example.com");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Asha Rao");
  const table = page.getByTestId("orders-table");
  await expect(table).toContainText("#5001");
  await expect(table).toContainText("#5004");
  await expect(table).not.toContainText("#5002");
  const cookie = (await context.cookies()).find((c) => c.name === "furni_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");

  await open(page, "/collection/101");
  await expect(page.getByTestId("record-inspector")).toHaveCount(0);
  const res = await open(page, "/manage");
  expect(res?.status()).toBe(404);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await open(page, "/account");
  await expect(page).toHaveURL(/\/login/);
});

test("administrator can inspect the records behind a product", async ({ page }) => {
  await signIn(page, "admin@furniform.local", "/collection/101");
  await expect(page).toHaveURL(/\/collection\/101$/);
  await expect(page.getByRole("navigation", { name: "Primary" }).first().getByRole("link", { name: "Management" })).toBeVisible();
  const inspector = page.getByTestId("record-inspector");
  await inspector.locator("summary").click();
  await expect(inspector).toContainText("supplier");
  await expect(inspector).toContainText("CedarWorks");
  await expect(inspector).toContainText("original_sql");
  await open(page, "/manage");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run the studio.");
});

test("open redirects are refused after sign-in", async ({ page }) => {
  await signIn(page, "student@furniform.local", "//evil.example/");
  await expect(page).toHaveURL(/\/account$/);
});
