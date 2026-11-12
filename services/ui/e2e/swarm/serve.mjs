// Serves the static demo build (dist/) with the same folder rewrites as render.yaml, so the swarm
// tests what Render serves. Usage: node e2e/swarm/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../dist/", import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4180);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".txt": "text/plain", ".glb": "model/gltf-binary",
  ".xml": "application/xml", ".wasm": "application/wasm", ".mp4": "video/mp4", ".webm": "video/webm",
};
const FOLDERS = ["product", "help", "developers", "why"];

async function file(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? path : null;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let path = decodeURIComponent(url.pathname);
  const folder = FOLDERS.find((f) => path === `/${f}`);
  if (folder) {
    res.writeHead(301, { location: `/${folder}/${url.search}` });
    return res.end();
  }
  let target = await file(join(root, normalize(path)));
  if (!target && path.endsWith("/")) target = await file(join(root, normalize(path), "index.html"));
  if (!target) {
    const f = FOLDERS.find((x) => path.startsWith(`/${x}/`));
    target = join(root, f ? `${f}/index.html` : "index.html");
  }
  const body = await readFile(target);
  res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
  res.end(body);
}).listen(port, () => console.log(`dist on http://localhost:${port}`));
