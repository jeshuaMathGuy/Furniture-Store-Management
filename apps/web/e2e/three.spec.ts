import { expect, test, type Page } from "@playwright/test";
import { open } from "./util";

const viewer = (page: Page) => page.getByTestId("furniture-viewer");

async function ready3d(page: Page) {
  await expect(viewer(page)).toHaveAttribute("data-mode", "3d");
  await expect(viewer(page)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(viewer(page).locator("canvas")).toHaveCount(1);
}

test.describe("FurnitureViewer", () => {
  test("renders the product in 3D with working controls", async ({ page }) => {
    await open(page, "/collection/102");
    await ready3d(page);
    await expect(viewer(page)).toHaveAttribute("data-model", "chair");

    await page.getByTestId("viewer-explode").click();
    await expect(viewer(page)).toHaveAttribute("data-exploded", "true");
    await expect(viewer(page)).toContainText("Exploded view of a procedural model");
    await page.getByTestId("viewer-dims").click();
    await expect(page.getByTestId("viewer-dims")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("viewer-reset").click();
    await expect(viewer(page)).toHaveAttribute("data-exploded", "false");
  });

  test("finish selection drives the model's variant", async ({ page }) => {
    await open(page, "/collection/201");
    await ready3d(page);
    const options = page.getByTestId("finish-option");
    await expect(options).toHaveCount(3);
    const first = await viewer(page).getAttribute("data-variant");
    await options.nth(1).click();
    await expect(viewer(page)).not.toHaveAttribute("data-variant", first!);
    await expect(options.nth(1).locator("input")).toBeChecked();
  });

  test("keyboard: the model is focusable and E explodes it", async ({ page }) => {
    await open(page, "/collection/101");
    await ready3d(page);
    const img = viewer(page).getByRole("img").first();
    await img.focus();
    await page.keyboard.press("e");
    await expect(viewer(page)).toHaveAttribute("data-exploded", "true");
    await page.keyboard.press("r");
    await expect(viewer(page)).toHaveAttribute("data-exploded", "false");
  });

  test("2D fallback is user-selectable, persists, and can be undone from the footer", async ({ page }) => {
    await open(page, "/collection/102");
    await ready3d(page);
    await page.getByTestId("viewer-mode-toggle").click();
    await expect(viewer(page)).toHaveAttribute("data-mode", "2d");
    await expect(viewer(page).locator("canvas")).toHaveCount(0);
    await expect(viewer(page).getByRole("img", { name: /Illustration of/ })).toBeVisible();
    await page.reload();
    await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
    await expect(viewer(page)).toHaveAttribute("data-mode", "2d");
    await page.getByTestId("render-mode-control").getByText("Auto").click();
    await ready3d(page);
  });
});

test.describe("cinematic hero", () => {
  test("six scenes are scrubbed by scroll and end on the live relational cards", async ({ page }) => {
    await open(page, "/");
    const hero = page.getByTestId("cinematic-hero");
    await expect(hero).toBeVisible();
    await expect(hero.locator("canvas")).toHaveCount(1);
    await expect(hero.locator("[data-scene]")).toHaveCount(6);
    await expect(hero.locator("[data-scene='1']")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.querySelector("[data-testid=cinematic-hero]")!.scrollHeight));
    await expect(hero.locator("[data-scene='6']")).toBeVisible({ timeout: 10_000 });
    await expect(hero.locator("[data-scene='6']")).toContainText("Every chair is also a row.");
    await expect(hero.locator("[data-scene='1']")).toBeHidden();
    await expect(hero.getByText("supplier_name")).toBeVisible();
    await expect(hero.getByText("CedarWorks")).toBeVisible();
  });

  test("reduced motion gets the static editorial hero instead", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await open(page, `${test.info().project.use.baseURL}/`);
    await expect(page.getByTestId("cinematic-hero")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Architecture");
    await expect(page.locator("canvas")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("showroom", () => {
  test("rooms, selection and detail panel come from the catalogue", async ({ page }) => {
    await open(page, "/showroom");
    const room = page.getByTestId("showroom");
    await expect(room).toHaveAttribute("data-mode", "3d");
    await expect(room.locator("canvas")).toHaveCount(1);
    await page.getByRole("button", { name: /Home office/ }).click();
    await expect(room).toHaveAttribute("data-room", "office");
    await page.getByTestId("showroom-piece").filter({ hasText: "Oak Executive Desk" }).click();
    await expect(room).toHaveAttribute("data-selected", "101");
    const detail = page.getByTestId("showroom-detail");
    await expect(detail).toContainText("Oak Executive Desk");
    await expect(detail).toContainText("180 × 85 × 76 cm");
    await page.keyboard.press("Escape");
    await expect(room).toHaveAttribute("data-selected", "");
  });
});

test.describe("studio", () => {
  test("switching pieces and comparing up to three", async ({ page }) => {
    await open(page, "/studio?product=101");
    await expect(page.getByTestId("studio-active-name")).toHaveText("Oak Executive Desk");
    await page.getByTestId("studio-piece").filter({ hasText: "Mesh Task Chair" }).click();
    await expect(page.getByTestId("studio-active-name")).toHaveText("Mesh Task Chair");
    await expect(viewer(page)).toHaveAttribute("data-model", "chair");
    await page.getByRole("button", { name: "Add to comparison" }).click();
    const table = page.getByTestId("compare-table");
    await expect(table.locator("thead th")).toHaveCount(3);
    await expect(table).toContainText("180 × 85 × 76 cm");
    await expect(table).toContainText("66 × 64 × 112 cm");
  });
});
