import { open } from "./util";
import { expect, test } from "@playwright/test";

const STAGES = ["UNF", "1NF", "2NF", "3NF", "BCNF", "4NF"] as const;

test.describe("normalization laboratory", () => {
  test("is public and shows the live snapshot summary", async ({ page }) => {
    const res = await open(page, "/lab/normalization");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Normalization, taken apart.");
    await expect(page.getByTestId("lab-summary")).toContainText("0 violations");
    await expect(page.getByTestId("lab-summary")).toContainText("SQL and in-memory results agree");
  });

  test("steps through all six stages; the inspector reports 0 violations at each", async ({ page }) => {
    await open(page, "/lab/normalization");
    const canvas = page.getByTestId("canvas");
    const inspector = page.getByTestId("inspector");
    for (const [i, id] of STAGES.entries()) {
      await expect(canvas).toHaveAttribute("data-stage", id);
      await expect(page.getByTestId("stage-button").nth(i)).toHaveAttribute("aria-current", "step");
      // walk every step within the stage
      const last = id === "UNF" ? "highlight" : "verified";
      while ((await canvas.getAttribute("data-phase")) !== last) await page.getByTestId("step-forward").click();
      await expect(inspector).toHaveAttribute("data-stage", id);
      await expect(inspector.getByTestId("violation-total")).toHaveText("0");
      await expect(inspector.getByText("SQL agrees")).toBeVisible();
      await expect(page.getByTestId("announcer")).toContainText(`Stage ${i + 1} of 6, ${id}`);
      if (id !== "UNF") {
        await expect(page.getByTestId("canvas-verified").first()).toContainText("0 missing, 0 spurious");
        for (const row of await inspector.getByTestId("reconstruction-row").all()) await expect(row).toContainText(/0\s*0$/);
      }
      if (id !== "4NF") await page.getByTestId("next-stage").click();
    }
    await expect(page.getByTestId("step-forward")).toBeDisabled();
  });

  test("1NF unnests the real items JSON into order-line rows", async ({ page }) => {
    await open(page, "/lab/normalization");
    await page.getByTestId("stage-button").nth(1).click();
    const canvas = page.getByTestId("canvas");
    await expect(canvas).toHaveAttribute("data-phase", "before");
    await expect(canvas.locator("[data-relation='unf_sales_order']")).toContainText("101 ×1 · CEDAR36");
    await page.getByTestId("step-forward").click();
    await expect(canvas.locator("[data-relation='unf_sales_order'] th[data-attr='items']")).toHaveAttribute("data-highlight", "nonatomic");
    await page.getByTestId("step-forward").click();
    await page.getByTestId("step-forward").click();
    const nf1 = canvas.locator("figure[data-relation='nf1_order_line']");
    await expect(nf1.locator("tbody tr")).toHaveCount(4);
    await expect(nf1.locator("tbody tr").first()).toHaveCSS("opacity", "1");
  });

  test("BCNF shows the lost dependency and the R₁ ∩ R₂ criterion", async ({ page }) => {
    await open(page, "/lab/normalization");
    await page.getByTestId("stage-button").nth(4).click();
    const inspector = page.getByTestId("inspector");
    await expect(inspector.getByTestId("lossless-notation").first()).toHaveText("R₁ ∩ R₂ = plan_code → R₂");
    await expect(inspector.locator("[data-testid='preservation-item'][data-preserved='false']")).toContainText("{order_id, supplier_id} → plan_code");
    await expect(inspector.getByTestId("evidence-disclaimer")).toContainText("evidence, not proof");
  });

  test("keyboard: arrow keys step and the stage buttons are reachable", async ({ page }) => {
    await open(page, "/lab/normalization");
    await page.getByTestId("step-forward").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("canvas")).toHaveAttribute("data-phase", "highlight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("canvas")).toHaveAttribute("data-stage", "1NF");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("canvas")).toHaveAttribute("data-stage", "UNF");
    await page.getByTestId("stage-button").nth(3).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("canvas")).toHaveAttribute("data-stage", "3NF");
  });

  test("reduced motion jumps straight to each stage's end state", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/lab/normalization");
    const canvas = page.getByTestId("canvas");
    await expect(canvas).toHaveAttribute("data-reduced", "true");
    await expect(canvas).toHaveAttribute("data-phase", "highlight");
    for (const id of STAGES.slice(1)) {
      await page.getByTestId("next-stage").click();
      await expect(canvas).toHaveAttribute("data-stage", id);
      await expect(canvas).toHaveAttribute("data-phase", "verified");
      await expect(page.getByTestId("violation-total")).toHaveText("0");
    }
    // rows are already fully visible: no transition in progress
    await expect(canvas.locator("figure[data-relation='supplier_certification'] tbody tr").first()).toHaveCSS("opacity", "1");
    await page.getByTestId("reset").click();
    await expect(canvas).toHaveAttribute("data-stage", "UNF");
    await expect(canvas).toHaveAttribute("data-phase", "highlight");
  });

  test("narrow screens get a single column without horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/lab/normalization");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("canvas").boundingBox();
    const ins = await page.getByTestId("inspector").boundingBox();
    expect(ins!.y).toBeGreaterThan(box!.y);
    expect(Math.abs(ins!.x - box!.x)).toBeLessThan(4);
  });
});
