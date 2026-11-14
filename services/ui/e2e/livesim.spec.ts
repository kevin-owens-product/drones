import { expect, test, type Page } from "@playwright/test";

// Live sim in Operate, against a stand-in for the bridge (sim/swarm/bridge.py) so CI needs no PX4.
// The real bridge and PX4 SIH are checked by sim/swarm/fly_check.py (make swarm-check).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

const BRIDGE = "http://localhost:8765";
const HOME = { lat: 35.738748, lon: -120.739944 };

interface Posted {
  path: string;
  body: Record<string, unknown>;
}

function vehicle(tail: string, i: number, over: Record<string, unknown> = {}) {
  return {
    tail_number: tail,
    lat: HOME.lat,
    lon: HOME.lon + i * 0.00009,
    alt_m: 0,
    classification: "UNCLASSIFIED",
    time: new Date().toISOString(),
    airworthiness: "airworthy",
    heading_deg: 0,
    ground_mps: 0,
    climb_mps: 0,
    battery_pct: 100,
    pack_v: 16.8,
    mode: "STANDBY",
    armed: false,
    nav_source: "gnss",
    gnss_trusted: true,
    pos_sigma_m: 0.5,
    airframe: "PX4 SIH quad (SIM)",
    source: "px4-sitl",
    landed: true,
    link: "ok",
    task: { kind: "idle", detail: "", progress: null, goal: null },
    ...over,
  };
}

/** A fake bridge: three vehicles, PX4-03 with a pack too low to pass launch checks. Records what the console posts. */
async function fakeBridge(page: Page, opts: { airborne?: boolean; climbOnLaunch?: boolean } = {}): Promise<Posted[]> {
  const posted: Posted[] = [];
  const flying = { armed: true, landed: false, alt_m: 20, mode: "HOLD" };
  let up: Record<string, unknown> = opts.airborne ? flying : {};
  await page.route(`${BRIDGE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "content-type": "application/json" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push({ path: url.pathname, body });
      if (opts.climbOnLaunch && body.task === "launch") up = flying;
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, detail: "accepted" }) });
    }
    const items = [vehicle("PX4-01", 0, up), vehicle("PX4-02", 1, up), vehicle("PX4-03", 2, { ...up, battery_pct: 40 })];
    const platforms = items.map((p) => ({ id: p.tail_number, tail_number: p.tail_number, designation: "PX4 SIH quad · live sim", group_size: "Group 1", portion_mark: "(U)", airworthiness: "airworthy", classification: "UNCLASSIFIED" }));
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items, platforms, swarm: { task: "idle" }, events: [], heard: 3 }) });
  });
  return posted;
}

test("without ?live the console never calls a bridge", async ({ page }) => {
  let calls = 0;
  await page.route(`${BRIDGE}/**`, (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/?live=off#operate");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  await expect(page.getByTestId("live-panel")).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(calls).toBe(0);
});

test("live sim shows the PX4 swarm, and launch sends only the vehicles that pass their checks", async ({ page }) => {
  const posted = await fakeBridge(page);
  await page.goto("/?live=1#operate");
  await expect(page.getByTestId("live-panel")).toContainText("PX4 · LIVE");
  // The scripted fleet steps aside so the map fits the swarm.
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(3);
  await expect(page.getByTestId("live-panel")).toContainText("1 held by launch checks");
  await page.getByRole("button", { name: "Launch 2 GO" }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]!.path).toBe("/v1/live/swarm");
  expect(posted[0]!.body).toMatchObject({ task: "launch", tails: ["PX4-01", "PX4-02"] });

  // The held vehicle's own panel says why it cannot launch.
  await page.locator("[data-tail='PX4-03']").click();
  await expect(page.getByTestId("fly-panel")).toContainText("Battery: 40%, need 60%");
  await expect(page.getByRole("button", { name: "Arm and take off" })).toBeDisabled();

  // Ask for the scripted fleet back beside the swarm.
  await page.getByLabel("Show the scripted demo fleet too").check();
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(15);
  await page.getByLabel("Show the scripted demo fleet too").uncheck();
});

test("formation at a picked point and go-to from the map", async ({ page }) => {
  const posted = await fakeBridge(page, { airborne: true });
  await page.goto("/?live=1#operate");
  await expect(page.getByTestId("live-panel")).toContainText("3 airborne");
  await page.getByLabel("Formation shape").selectOption("wedge");
  await page.getByRole("button", { name: "Pick a point" }).click();
  await expect(page.locator(".tac-hint")).toHaveText("Click the map to place the point");
  const map = page.locator(".tac");
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect(page.getByTestId("live-marks")).toBeVisible();
  await page.getByRole("button", { name: "Fly formation at the point" }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]!.body).toMatchObject({ task: "formation", shape: "wedge" });
  expect(typeof posted[0]!.body.lat).toBe("number");

  await page.locator("[data-tail='PX4-02']").click();
  await page.getByRole("button", { name: "Go to a point" }).click();
  await page.mouse.click(box.x + box.width / 3, box.y + box.height / 2);
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[1]!).toMatchObject({ path: "/v1/live/command", body: { tail: "PX4-02", action: "goto" } });

  await page.getByRole("button", { name: "Test lost link" }).click();
  await expect.poll(() => posted.length).toBe(3);
  expect(posted[2]!.body).toMatchObject({ tail: "PX4-02", action: "link", on: false });
});

test("roles that cannot command see the swarm but not the controls", async ({ page }) => {
  await fakeBridge(page, { airborne: true });
  // The local demo signs in as a commander; pretend to be an analyst, who can watch but not command.
  await page.route("**/v1/me", (route) =>
    route.fulfill({ status: 200, headers: { "X-Classification-Banner": "UNCLASSIFIED // DEMO DATA", "content-type": "application/json" }, body: JSON.stringify({ id: "a", username: "analyst", display_name: "Analyst", citizenship: "USA", clearance: "UNCLASSIFIED", ntk_programs: [], roles: ["analyst"] }) }),
  );
  await page.goto("/?live=1#operate");
  await expect(page.getByTestId("live-panel")).toContainText("Your role cannot command vehicles");
  await expect(page.getByRole("button", { name: "Return all" })).toBeDisabled();
});

test("no bridge running: the console says so and can switch live sim off", async ({ page }) => {
  await page.route(`${BRIDGE}/**`, (route) => route.abort());
  await page.goto("/?live=1#operate");
  await expect(page.getByText(`No bridge at ${BRIDGE}`)).toBeVisible();
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  await page.getByRole("button", { name: "Switch live sim off" }).click();
  await expect(page.getByTestId("live-panel")).toHaveCount(0);
  // Remembered: a later visit without ?live stays off.
  await page.goto("/#operate");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  await expect(page.locator(".live-panel")).toHaveCount(0);
});

test("an approved plan from Missions launches the GO vehicles and sweeps its area", async ({ page }) => {
  const posted = await fakeBridge(page, { climbOnLaunch: true });
  await page.goto("/?live=1#missions");
  const root = page.getByTestId("missions");
  // A plan still in review cannot be flown.
  await root.getByRole("button", { name: /Ridge relay under GNSS denial/ }).click();
  await expect(page.getByTestId("live-handoff")).toContainText("Approve the plan first.");
  await expect(page.getByRole("button", { name: "Fly on live sim" })).toBeDisabled();

  await root.getByRole("button", { name: /Survey grid north/ }).click();
  await expect(page.getByTestId("live-handoff")).toContainText("Area A (north-west field)");
  await page.getByRole("button", { name: "Fly on live sim" }).click();
  await expect(page).toHaveURL(/#operate$/);
  const plan = page.getByTestId("live-plan");
  await expect(plan).toContainText("Plan · Survey grid north");
  await plan.getByLabel("Area to sweep").selectOption({ label: "Ridge" });
  await plan.getByRole("button", { name: "Launch 2 and sweep" }).click();

  // Launch only the GO vehicles, wait for them to climb, then sweep the Ridge and come home.
  await expect.poll(() => posted.length, { timeout: 15_000 }).toBe(2);
  expect(posted[0]!.body).toMatchObject({ task: "launch", tails: ["PX4-01", "PX4-02"] });
  expect(posted[1]!.body).toMatchObject({ task: "sweep", then: "rtl" });
  expect(typeof posted[1]!.body.lat).toBe("number");
  await expect(page.getByTestId("live-panel")).toContainText("Survey grid north: sweeping Ridge, then home");

  await plan.getByRole("button", { name: "Clear plan" }).click();
  await expect(page.getByTestId("live-plan")).toHaveCount(0);
});
