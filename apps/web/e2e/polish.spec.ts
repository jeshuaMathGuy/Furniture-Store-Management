import { expect, test } from "@playwright/test";
import { open } from "./util";

test("assembly step slider and showroom viewpoints with announcements", async ({ page }) => {
  await open(page, "/collection/102");
  const viewer = page.getByTestId("furniture-viewer");
  await expect(viewer).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await page.getByTestId("viewer-explode").click();
  await expect(page.getByTestId("assembly-panel")).toContainText("Illustration of the procedural model, not a manufacturer drawing.");
  await expect(viewer.getByTestId("part-label")).toHaveCount(4);
  await page.getByTestId("assembly-slider").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("assembly-step")).toHaveText("Step 2 of 4: Upholstered seat");

  await open(page, "/showroom");
  const room = page.getByTestId("showroom");
  await expect(room).toHaveAttribute("data-mode", "3d");
  await page.getByRole("button", { name: /Home office/ }).click();
  await page.getByTestId("vantage").filter({ hasText: "Window light" }).click();
  await expect(room).toHaveAttribute("data-view", "window");
  await expect(page.getByTestId("showroom-announcer")).toHaveText("Home office: Window light view.");
  const piece = page.getByTestId("showroom-piece").filter({ hasText: "Oak Executive Desk" });
  await piece.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("showroom-detail").getByRole("heading", { name: "Oak Executive Desk" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(piece).toBeFocused();
});
