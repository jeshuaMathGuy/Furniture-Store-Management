import { open } from "./util";
import { expect, test } from "@playwright/test";

const priceOf = (text: string) => Number(text.replace(/[^\d]/g, ""));

test.describe("navigation", () => {
  test("primary navigation reaches every experience", async ({ page }) => {
    // Navigation only: 2D mode keeps software-WebGL scene builds off the critical path (3D is covered by three.spec.ts).
    await page.addInitScript(() => localStorage.setItem("furni:render", "2d"));
    await open(page, "/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Architecture");
    const nav = page.getByRole("navigation", { name: "Primary" }).first();
    for (const [label, heading] of [
      ["Collection", "Pieces made to be lived around."],
      ["Showroom", "Rooms you can walk through."],
      ["Studio", "Configure, compare, commit."],
      ["Database Lab", "Take the schema apart."],
      ["Discover", "Architecture"],
    ] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await expect(nav.getByRole("link", { name: "Management" })).toHaveCount(0);
  });

  test("unknown product returns a real 404", async ({ page }) => {
    const res = await open(page, "/collection/999999");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This room is empty." })).toBeVisible();
  });
});

test.describe("catalog", () => {
  test("lists all 20 products from the database", async ({ page }) => {
    await open(page, "/collection");
    await expect(page.getByTestId("product-card")).toHaveCount(20);
    await expect(page.getByTestId("result-count")).toHaveText("20 pieces");
  });

  test("category filter shows only that category", async ({ page }) => {
    await open(page, "/collection");
    await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Office" }).click();
    await expect(page).toHaveURL(/category=office/);
    const cards = page.getByTestId("product-card");
    await expect(cards.first()).toBeVisible();
    for (const c of await cards.all()) await expect(c).toHaveAttribute("data-category", "office");
  });

  test("search, price ceiling and sorting combine", async ({ page }) => {
    await open(page, "/collection");
    await page.getByPlaceholder("Search name or material").fill("oak");
    await page.getByPlaceholder("Max ₹").fill("50000");
    await page.getByLabel("Sort").selectOption("price_asc");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/q=oak/);
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible(); // filtered page has rendered
    const prices = await page.getByTestId("product-card").evaluateAll((els) =>
      els.map((e) => e.querySelector(".font-display")?.textContent ?? ""));
    const values = prices.map(priceOf);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v <= 50000)).toBe(true);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  test("an impossible filter shows the empty state, and clearing restores results", async ({ page }) => {
    await open(page, "/collection?min=9999999");
    await expect(page.getByText("Nothing matches, yet.")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).first().click();
    await expect(page).toHaveURL(/\/collection$/);
    await expect(page.getByTestId("product-card")).toHaveCount(20);
  });

  test("malformed query parameters are ignored, not fatal", async ({ page }) => {
    const res = await open(page, "/collection?category=attic&min=abc&sort=DROP");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("product-card")).toHaveCount(20);
  });

  test("a card opens its product page with database details", async ({ page }) => {
    await open(page, "/collection?category=living");
    const name = await page.getByTestId("product-card").first().getByRole("heading").textContent();
    await page.getByTestId("product-card").first().getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name!.trim());
    await expect(page.locator("dt", { hasText: "Dimensions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  });
});

test.describe("accessibility basics", () => {
  test("skip link moves focus to main content", async ({ page }) => {
    await open(page, "/collection");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });

  test("reduced motion disables entrance animation", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await open(page, `${test.info().project.use.baseURL}/`);
    const duration = await page.locator(".rise").first().evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
    await ctx.close();
  });
});
