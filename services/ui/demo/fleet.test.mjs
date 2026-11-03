import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemo } from "./scenario.mjs";

// One airworthiness record: work orders, lot holds and people's calls all land on /v1/platforms.
const attrition = JSON.parse(readFileSync(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const MAINTAINER = { display_name: "Demo Maintainer", roles: ["maintainer"], org: "CUS-A" };
const OPERATOR = { display_name: "Demo Operator", roles: ["operator"], org: "CUS-A" };
const call = (demo, who, method, path, body) => demo.handle(method, new URL(path, "http://x"), body ? JSON.stringify(body) : "", who);
const tail = (demo, t) => call(demo, MAINTAINER, "GET", "/v1/platforms").body.items.find((p) => p.tail_number === t);

test("a grounded airframe can't return to service while its work order is open", () => {
  const demo = createDemo({ attrition });
  const nx12 = tail(demo, "NX-12");
  const out = call(demo, MAINTAINER, "PATCH", `/v1/platforms/${nx12.id}`, { airworthiness: "airworthy" });
  assert.equal(out.status, 409);
  assert.match(out.body.detail, /WO-5102/);
  assert.equal(tail(demo, "NX-12").airworthiness, "grounded");
  assert.equal(call(demo, MAINTAINER, "POST", "/v1/maintenance/close", { id: "WO-5102" }).status, 200);
  assert.equal(tail(demo, "NX-12").airworthiness, "airworthy");
  assert.match(tail(demo, "NX-12").service_note, /WO-5102 closed/);
});

test("holding a lot restricts every tail that carries it until its inspection closes", () => {
  const demo = createDemo({ attrition });
  const alert = attrition.autopsy.alerts.find((a) => a.flagged);
  assert.equal(tail(demo, "NX-05").airworthiness, "airworthy");
  assert.equal(call(demo, MAINTAINER, "POST", "/v1/attrition/hold", { attribute: alert.attribute, value: alert.value }).status, 200);
  assert.equal(tail(demo, "NX-05").airworthiness, "restricted");
  assert.match(tail(demo, "NX-05").airworthiness_reason, new RegExp(alert.value));
  const live = call(demo, MAINTAINER, "GET", "/v1/missions").body.items ?? [];
  assert.ok(Array.isArray(live));
  assert.equal(call(demo, MAINTAINER, "POST", "/v1/maintenance/close", { id: "WO-H-NX-05" }).status, 200);
  assert.equal(tail(demo, "NX-05").airworthiness, "airworthy");
});

test("an operator can't ground an airframe or close a work order", () => {
  const demo = createDemo({ attrition });
  const nx01 = tail(demo, "NX-01");
  assert.equal(call(demo, OPERATOR, "PATCH", `/v1/platforms/${nx01.id}`, { airworthiness: "grounded" }).status, 403);
  assert.equal(call(demo, OPERATOR, "POST", "/v1/maintenance/close", { id: "WO-5101" }).status, 403);
});

test("a customer sees only its own accounts", () => {
  const demo = createDemo({ attrition });
  const users = call(demo, OPERATOR, "GET", "/v1/users").body.items;
  assert.ok(users.length > 0);
  assert.ok(users.every((u) => u.org === "CUS-A"));
});
