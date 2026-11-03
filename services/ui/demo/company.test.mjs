import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";
import { BOMS, CATALOG, bom, createSupply } from "./supply.mjs";
import { ORDERS } from "./company.mjs";

const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const ADMIN = { display_name: "Demo Admin", roles: ["admin"] };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"] };
const get = (demo, path, who = ADMIN) => demo.handle("GET", new URL(`http://x${path}`), "", who);
const post = (demo, path, body, who = ADMIN) => demo.handle("POST", new URL(`http://x${path}`), JSON.stringify(body), who);

test("Strike SKUs are catalogue entries only: no BOM, no orders, no build plan (ADR-0016)", () => {
  const strike = CATALOG.filter((c) => c.restricted);
  assert.equal(strike.length, 3);
  for (const s of strike) {
    assert.equal(BOMS[s.sku], undefined);
    assert.equal(s.specs.length, 0);
    assert.ok(!ORDERS.some((o) => o.sku === s.sku));
  }
  const body = get(createDemo({ attrition }), "/v1/company").body;
  assert.ok(!body.build.some((b) => b.sku.endsWith("-S")));
  assert.ok(!body.sop.some((r) => r.sku.endsWith("-S")));
  assert.ok(body.catalog.filter((c) => c.restricted).every((c) => c.bom === null));
});

test("unpublished Neros specs say so instead of being filled in", () => {
  const a8 = CATALOG.find((c) => c.sku === "ARCHER-8");
  assert.deepEqual(a8.specs, [["Range, speed, weight, flight time", "not published"]]);
  for (const c of CATALOG) assert.match(c.source, /neros\.tech|businesswire/);
});

test("a BOM rolls up cost and every part has a supplier", () => {
  const b = bom("ARCHER-5");
  assert.ok(b.usd > 0);
  assert.ok(b.rows.every((r) => r.supplier && r.qty > 0));
});

test("holding the flagged ESC lot quarantines its stock, opens a SCAR and cuts what the factory can build", () => {
  const births = [{ serial: "S1", tail_number: "NX-05", parts: [{ part: "esc", lot: "ESC-2611" }], verdict: { status: "airworthy" } }];
  const s = createSupply({ births });
  const before = s.snapshot({ holds: [] });
  const after = s.snapshot({ holds: [{ attribute: "esc_lot", value: "ESC-2611" }] });
  const lot = after.lots.find((l) => l.lot === "ESC-2611");
  assert.equal(lot.status, "quarantined");
  assert.deepEqual(lot.where_used.map((w) => w.tail), ["NX-05"]);
  assert.match(after.suppliers.find((x) => x.id === "SUP-PW").scar, /ESC-2611/);
  const b5 = (snap) => snap.build.find((x) => x.sku === "ARCHER-5");
  assert.ok(b5(after).qty < b5(before).qty);
  assert.ok(after.work_orders.some((w) => w.tail === "NX-05" && w.kind === "quality hold"));
  assert.ok(after.exceptions.some((e) => e.kind === "lot quarantined"));
});

test("the Attrition shortfall becomes a kit plan for the unit's model", () => {
  const body = get(createDemo({ attrition }), "/v1/company").body;
  const alpha = body.replenishment.find((r) => r.unit === "Alpha");
  assert.equal(alpha.sku, "ARCHER-5");
  assert.equal(alpha.short, 19);
  assert.equal(alpha.from_stock + alpha.to_build, 19);
  assert.ok(alpha.spares.some((x) => x.dg));
});

test("orders get a projected ship date, and an export order waits on its licence", () => {
  const body = get(createDemo({ attrition }), "/v1/company").body;
  const c1 = body.orders.find((o) => o.id === "ORD-C1");
  assert.equal(c1.projected, null);
  assert.equal(c1.at_risk, true);
  assert.match(c1.why, /licence/);
  for (const o of body.orders.filter((x) => x.id !== "ORD-C1")) assert.match(o.projected, /^\d{4}-\d{2}-\d{2}$/);
});

test("shipping a kit and closing a work order need fleet.write and land in the audit log", () => {
  const demo = createDemo({ attrition });
  assert.equal(post(demo, "/v1/company/ship", { plan: "KIT-Alpha" }, OPERATOR).status, 403);
  const shipped = post(demo, "/v1/company/ship", { plan: "KIT-Alpha" });
  assert.equal(shipped.status, 200);
  assert.equal(post(demo, "/v1/company/ship", { plan: "KIT-Alpha" }).status, 409);
  const before = get(demo, "/v1/platforms").body.items.find((p) => p.tail_number === "NX-08");
  assert.equal(before.airworthiness, "restricted");
  assert.equal(post(demo, "/v1/company/work-orders/close", { id: "WO-5101" }).status, 200);
  const after = get(demo, "/v1/platforms").body.items.find((p) => p.tail_number === "NX-08");
  assert.equal(after.airworthiness, "airworthy");
  const actions = get(demo, "/v1/audit").body.items.map((r) => r.action);
  for (const a of ["kit.ship", "work_order.close", "platform.return_to_service"]) assert.ok(actions.includes(a), a);
  assert.ok(!get(demo, "/v1/maintenance").body.items.some((w) => w.id === "WO-5101"));
});

test("the digital thread follows one serial from order to sustainment", () => {
  const demo = createDemo({ attrition });
  const t = get(demo, "/v1/company/thread?tail=NX-05").body;
  assert.deepEqual(t.steps.map((s) => s.stage), ["Order", "Build", "EOL bench", "Ship", "Fly", "Sustain"]);
  assert.ok(t.steps[1].parts.some((p) => p.lot === "ESC-2611" && p.supplier));
  assert.equal(get(demo, "/v1/company/thread?tail=ZZ-1").status, 404);
});
