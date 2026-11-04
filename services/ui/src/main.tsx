import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Training, scenarioParam } from "./operate/Training";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import "./operate/operate.css";
import { hasDemoSession, installStaticDemo } from "./staticDemo";

// Hosted demo: a first visit to the bare domain lands on the product site. Deep links
// (#operate, #ops, ...) and signed-in visitors go straight to the console.
const toSite = import.meta.env.VITE_STATIC_DEMO === "1" && window.location.pathname === "/" && !window.location.hash && !window.location.search && !hasDemoSession();
if (toSite) window.location.replace("/product/");
if (import.meta.env.VITE_STATIC_DEMO === "1" && !toSite) installStaticDemo();

const root = document.getElementById("root");
if (!root) {
  throw new Error("root missing");
}
if (!toSite) createRoot(root).render(
  <StrictMode>
    <App />
    {scenarioParam() && <Training scenario={scenarioParam() ?? ""} />}
  </StrictMode>,
);
