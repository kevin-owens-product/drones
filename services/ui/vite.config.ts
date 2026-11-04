import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

// Cesium injects its script and stylesheet into every HTML page. Only the console needs it,
// so the public pages (product, help, developers) are left alone.
function consoleOnly(plugins: Plugin | Plugin[]): Plugin[] {
  return (Array.isArray(plugins) ? plugins : [plugins]).map((p) => {
    const hook = p.transformIndexHtml;
    if (typeof hook !== "function") return p;
    return {
      ...p,
      transformIndexHtml(html, ctx) {
        return ctx.path === "/index.html" ? hook.call(this, html, ctx) : html;
      },
    } as Plugin;
  });
}

export default defineConfig({
  plugins: [react(), ...consoleOnly(cesium())],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        console: resolve(__dirname, "index.html"),
        product: resolve(__dirname, "product/index.html"),
        help: resolve(__dirname, "help/index.html"),
        developers: resolve(__dirname, "developers/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:18080",
      "/health": "http://localhost:18080",
      "/ready": "http://localhost:18080",
    },
  },
});
