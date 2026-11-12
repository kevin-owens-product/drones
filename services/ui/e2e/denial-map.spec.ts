import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("scout passes map the unbriefed spoofing zone and the route leaves it", async ({ page }) => {
  await page.goto("/#denial");
  const root = page.getByTestId("denial-map");
  await expect(root.locator(".page-title")).toHaveText("Denial map");
  const exposure = root.locator(".stat").first().locator(".stat-value");
  await expect(exposure).not.toHaveText("0 m");
  await root.locator("#dm-passes").fill("4");
  await expect(exposure).toHaveText("0 m");
  await expect(root.locator(".dm-cell").first()).toBeVisible();
});

test("the radio layers show where the links hold over the terrain, and the jammer shrinks them", async ({ page }) => {
  await page.goto("/#denial");
  const root = page.getByTestId("denial-map");
  await root.getByRole("button", { name: "Control link" }).click();
  const line = root.getByTestId("coverage-line");
  await expect(line).toContainText("Control on 900 MHz holds over");
  const clear = Number((await line.textContent())?.match(/over (\d+)%/)?.[1]);
  await root.getByLabel("EW emitter on (900 MHz, 2.4 GHz)").check();
  await expect(line).toContainText("the emitter on");
  const jammed = Number((await line.textContent())?.match(/over (\d+)%/)?.[1]);
  expect(jammed).toBeLessThan(clear);
  await expect(root.locator(".dm-cov").first()).toBeVisible();
});
