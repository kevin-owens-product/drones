// A self-contained demo of the operator console: serves the built UI and a
// mock of the API it reads, with a scripted sortie. No database, broker, or
// PX4 needed. The data is synthetic and the console says so in the banner.
//
//   npm run build && node demo/server.mjs   (then open http://localhost:4173)
//   A2E_DEMO_FLEET=300 adds synthetic vehicles; A2E_DEMO_SPEED sets sim speed.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNER, createDemo } from "./scenario.mjs";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const ASSETS = fileURLToPath(new URL("./assets/", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);

let terrain = null;
try {
  terrain = JSON.parse(await readFile(join(ASSETS, "terrain.json"), "utf8"));
} catch {
  terrain = null;
}
let attrition = null;
try {
  attrition = JSON.parse(await readFile(join(ASSETS, "attrition.json"), "utf8"));
} catch {
  attrition = null;
}
let readme = "";
try {
  readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
} catch {
  /* Eval shows an empty table without the README */
}
const demo = createDemo({ speed: process.env.A2E_DEMO_SPEED ?? 6, extra: process.env.A2E_DEMO_FLEET ?? 0, terrain, attrition, readme });

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  if (path.startsWith("/v1/")) {
    let raw = "";
    if (req.method === "POST") for await (const chunk of req) raw += chunk;
    const out = demo.handle(req.method ?? "GET", url, raw);
    res.setHeader("X-A2E-Banner", BANNER);
    res.setHeader("content-type", "application/json");
    res.statusCode = out.status;
    res.end(JSON.stringify(out.body));
    return;
  }
  if (path.startsWith("/demo-assets/")) {
    const asset = normalize(join(ASSETS, path.slice("/demo-assets/".length)));
    try {
      if (!asset.startsWith(ASSETS)) throw new Error("outside");
      const body = await readFile(asset);
      res.setHeader("content-type", TYPES[extname(asset)] ?? "application/octet-stream");
      res.setHeader("cache-control", "max-age=3600");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }
  const file = normalize(join(DIST, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.setHeader("content-type", "text/html");
    res.end(await readFile(join(DIST, "index.html")));
  }
}).listen(PORT, () => console.log(`demo console on http://localhost:${PORT}${demo.extra ? ` with ${demo.extra} synthetic vehicles` : ""}`));
