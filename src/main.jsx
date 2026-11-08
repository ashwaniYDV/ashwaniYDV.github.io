import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./assets/css/main.css";
import "./assets/css/home.css";
import "./assets/css/standards-mode.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Solid State keeps intro animations paused until the page has loaded.
const ready = () => window.setTimeout(() => document.body.classList.remove("is-loading"), 100);
if (document.readyState === "complete") ready();
else window.addEventListener("load", ready, { once: true });
