import { open } from "./util";
import { expect, test } from "@playwright/test";

test("mobile: menu disclosure exposes primary navigation without horizontal scroll", async ({ page }) => {
  await open(page, "/collection");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByText("Menu", { exact: true }).click();
  const menu = page.locator("details[open] nav[aria-label='Primary']");
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "Database Lab" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Take the schema apart.");
  await expect(page.locator("details[open]")).toHaveCount(0);
});

test("mobile: product grid is a single column", async ({ page }) => {
  await open(page, "/collection");
  const lefts = await page.getByTestId("product-card").evaluateAll((els) => els.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
});
