import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("missions opens on a seeded board with launch checks and an approval chain", async ({ page }) => {
  await page.goto("/#missions");
  const root = page.getByTestId("missions");
  await expect(root.getByRole("region", { name: "Closed" })).toContainText("Night survey");
  await root.getByRole("button", { name: /Road junction overwatch/ }).click();
  await expect(root).toContainText("NX-12 grounded");
  await expect(root).toContainText("Drafted");
});

test("debrief replays a flown plan with events and findings", async ({ page }) => {
  await page.goto("/#debrief");
  const root = page.getByTestId("debrief");
  await root.getByRole("button", { name: /Night survey/ }).click();
  await expect(root).toContainText("Effective sorties per operator-hour");
  await expect(root).toContainText("Link lost");
  await root.getByRole("button", { name: "Next event" }).click();
  await expect(root.getByRole("img", { name: /Replay map/ })).toBeVisible();
});

test("eval lists the README results with where each was measured", async ({ page }) => {
  await page.goto("/#eval");
  const root = page.getByTestId("eval");
  await expect(root).toContainText("Runs that held the target, tracker v2");
  await expect(root).toContainText("PX4 SITL");
});
