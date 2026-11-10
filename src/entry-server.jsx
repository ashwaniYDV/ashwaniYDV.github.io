// Build-time renderer used by scripts/prerender.mjs. Never shipped to the browser.
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import App from "./App.jsx";

export { posts } from "./posts";
export { BLOG_SUBTITLE } from "./pages/BlogIndex.jsx";
export { sections } from "./utils/registry.js";

export function render(url) {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );
}
