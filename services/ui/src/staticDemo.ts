import { BANNER, createDemo } from "../demo/scenario.mjs";
import terrain from "../demo/assets/terrain.json";

/**
 * Hosted demo: no server, so the scripted sortie runs in the page and answers
 * the console's /v1 calls itself. Same scenario code as demo/server.mjs, same
 * DEMO DATA banner. Built only with VITE_STATIC_DEMO=1 (npm run build:static).
 * Add ?fleet=300 to the URL for the fleet-scale view.
 */
export function installStaticDemo(): void {
  const params = new URLSearchParams(window.location.search);
  const demo = createDemo({
    speed: 6,
    extra: Number(params.get("fleet") ?? 0) || 0,
    terrain,
    assetBase: `${import.meta.env.BASE_URL}demo-assets/`,
  });
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/v1/")) {
      const out = demo.handle(init?.method ?? "GET", url, typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify(out.body), {
        status: out.status,
        headers: { "content-type": "application/json", "X-A2E-Banner": BANNER },
      });
    }
    return real(input, init);
  };
}
