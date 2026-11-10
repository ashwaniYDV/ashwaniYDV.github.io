import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
// Self-hosted (was a render-blocking stylesheet from cdnjs): one fewer origin to connect to.
import "font-awesome/css/font-awesome.min.css";
import "./assets/css/main.css";
import "./assets/css/home.css";
import "./assets/css/standards-mode.css";
import "highlight.js/styles/atom-one-dark.css";
import "./assets/css/blog.css";
import "./assets/css/enhancements.css";
import "./assets/css/utils.css";
import App from "./App.jsx";

const app = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

// Built pages are pre-rendered (scripts/prerender.mjs), so attach to that markup
// instead of throwing it away and rendering again. `npm run dev` serves an
// empty #root, which still needs a normal render.
// The intro animation (body.is-loading) is started by an inline script in index.html.
const container = document.getElementById("root");
if (container.hasChildNodes()) hydrateRoot(container, app);
else createRoot(container).render(app);
