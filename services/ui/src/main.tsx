import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Training, scenarioParam } from "./operate/Training";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import "./operate/operate.css";
import { installStaticDemo } from "./staticDemo";

if (import.meta.env.VITE_STATIC_DEMO === "1") installStaticDemo();

const root = document.getElementById("root");
if (!root) {
  throw new Error("root missing");
}
createRoot(root).render(
  <StrictMode>
    <App />
    {scenarioParam() && <Training scenario={scenarioParam() ?? ""} />}
  </StrictMode>,
);
