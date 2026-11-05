import { expect, test } from "@playwright/test";

// Runs against the demo sortie (node demo/server.mjs), like operate.spec.ts.
test.skip(!process.env.A2E_DEMO, "needs the demo server");

test("the guided walk opens on ?tour, moves between pages, and remembers where it was", async ({ page }) => {
  await page.goto("/?tour#ops");
  const tour = page.getByTestId("tour");
  await expect(tour).toContainText("1 of");
  await expect(tour).toContainText("Start where Neros starts");
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/#quality$/);
  await expect(tour).toContainText("2 of");
  await page.goto("/#operate");
  await expect(tour).toContainText("2 of");
  await tour.getByRole("button", { name: "Take me there" }).click();
  await expect(page).toHaveURL(/#quality$/);
  await tour.getByRole("button", { name: "Close the guided walk" }).click();
  await expect(tour).toBeHidden();
});

test("the palette finds a tail and a plan and opens each on its page", async ({ page }) => {
  await page.goto("/#ops");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("combobox").fill("NX-05");
  await expect(page.locator("#palette-list")).toContainText("Airframe");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#fleet$/);
  await expect(page.getByTestId("birth-record")).toContainText("Flagged by Attrition");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("combobox").fill("M-1034");
  await expect(page.locator("#palette-list")).toContainText("Plan");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#missions$/);
  await expect(page.locator(".ticket.is-selected")).toContainText("M-1034");
});
