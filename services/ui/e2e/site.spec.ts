import { expect, test } from "@playwright/test";

test("product site runs the live picture and links into the console", async ({ page }) => {
  await page.goto("/product/");
  await expect(page.locator("h1")).toContainText("one record");
  await expect(page.locator("#scope canvas")).toBeVisible();
  await expect(page.locator("#s-air")).not.toHaveText("0");
  await expect(page.locator("#serial")).toContainText("Born on the bench");
  await expect(page.locator(".nav-cta a.btn-primary")).toHaveAttribute("href", "/#home");
  // Public safety is a second market below the defense story, not in place of it.
  await expect(page.locator("#public-safety .calls li")).toHaveCount(5);
  const order = await page.evaluate(() => [...document.querySelectorAll("main > section[id]")].map((s) => s.id));
  expect(order.indexOf("public-safety")).toBeGreaterThan(order.indexOf("platform"));
});

test("help center search filters articles", async ({ page }) => {
  await page.goto("/help/");
  await page.fill("#q", "quality hold");
  await expect(page.locator("#holds")).toBeVisible();
  await expect(page.locator("#quote")).toBeHidden();
  await page.fill("#q", "zzqx");
  await expect(page.locator("#empty")).toBeVisible();
});

test("developer explorer answers from the demo and refuses inbound commands", async ({ page }) => {
  await page.goto("/developers/");
  await expect(page.locator("#ex-status")).toContainText("200 OK");
  await page.getByRole("button", { name: "Send an inbound command" }).click();
  await expect(page.locator("#ex-status")).toContainText("403");
  await expect(page.locator("#ex-res")).toContainText("ADR-0016");
  await page.getByRole("button", { name: "Updates as an allied tenant" }).click();
  await expect(page.locator("#ex-res")).toContainText("_withheld");
  await page.getByRole("button", { name: "Approve a launch as the pilot" }).click();
  await expect(page.locator("#ex-status")).toContainText("403");
  await expect(page.locator("#ex-res")).toContainText("supervisor's approval");
  await page.getByRole("button", { name: "The live console as the contractor" }).click();
  await expect(page.locator("#ex-res")).toContainText("stay with the agency");
  await expect(page.locator("#mav tbody tr")).not.toHaveCount(0);
});
