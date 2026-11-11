import type { Page } from "@playwright/test";

/** Navigate and wait until React has hydrated, so clicks are handled by the router and not lost mid-hydration. */
export async function open(page: Page, url: string) {
  const res = await page.goto(url);
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
  return res;
}
