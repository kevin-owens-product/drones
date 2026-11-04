/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STATIC_DEMO?: string;
  /** ntfy topic for visit alerts on the hosted demo; set in the Render dashboard, never committed. */
  readonly VITE_NTFY_TOPIC?: string;
}
