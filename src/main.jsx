import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./assets/css/main.css";
import "./assets/css/home.css";
import "./assets/css/standards-mode.css";
import "highlight.js/styles/atom-one-dark.css";
import "./assets/css/blog.css";
import "./assets/css/enhancements.css";
import App from "./App.jsx";

// Pages are pre-rendered at build time (scripts/prerender.mjs) for link
// previews and SEO; the client then takes over with a fresh render.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Solid State keeps intro animations paused until the page has loaded.
const ready = () => window.setTimeout(() => document.body.classList.remove("is-loading"), 100);
if (document.readyState === "complete") ready();
else window.addEventListener("load", ready, { once: true });
