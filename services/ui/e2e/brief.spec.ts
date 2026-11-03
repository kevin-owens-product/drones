import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("a plain-words brief becomes a proposal that waits for approval", async ({ page }) => {
  await page.goto("/#brief");
  const root = page.getByTestId("brief");
  await root.getByRole("button", { name: "Read brief" }).click();
  const result = root.getByLabel("Proposal");
  await expect(result).toContainText("awaiting approval");
  await expect(result).toContainText("Search Area B (north field)");
  await expect(result).toContainText("Not used: NX-12");
  await result.getByRole("button", { name: "Approve" }).click();
  await expect(result).toContainText("Nothing was sent to a vehicle");
});

test("a request to strike is refused", async ({ page }) => {
  await page.goto("/#brief");
  const root = page.getByTestId("brief");
  await root.locator("#br-text").fill("strike the road junction");
  await root.getByRole("button", { name: "Read brief" }).click();
  await expect(root.getByLabel("Proposal")).toContainText("ADR-0016");
});
