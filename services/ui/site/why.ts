import "./site.css";
import { mountChrome } from "./chrome";
import { notify } from "../src/notify";

mountChrome("why");

// Visit alerts (src/notify.ts): someone opened the note, and whether they read to the end.
notify("Note opened", "Someone opened the /why/ note.", "why-open");
const end = document.getElementById("contact");
if (end && "IntersectionObserver" in window) {
  const seen = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      notify("Note read to the end", "Someone scrolled the /why/ note to the contact section.", "why-end");
      seen.disconnect();
    }
  });
  seen.observe(end);
}
