import { useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router";
import Header from "./components/Header.jsx";
import Menu from "./components/Menu.jsx";
import Footer from "./components/Footer.jsx";
import JioSaavnWidget from "./components/JioSaavnWidget.jsx";
import Home from "./pages/Home.jsx";
import BlogIndex from "./pages/BlogIndex.jsx";
import BlogPost from "./pages/BlogPost.jsx";
import NotFound from "./pages/NotFound.jsx";
import UtilsIndex from "./pages/UtilsIndex.jsx";
import UtilPage from "./pages/UtilPage.jsx";
import { getUtil } from "./utils/registry.js";
import { useBodyClass } from "./hooks.js";

export default function App() {
  const { pathname, hash, key } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // Tool pages are full-screen apps: no navbar, footer or floating widgets.
  // The tool's own toolbar carries the "‹ Utils" link back.
  const tool = getUtil(pathname.match(/^\/utils\/([^/]+)\/?$/)?.[1]);
  const isToolPage = Boolean(tool);
  // Viewport-locked tools stop the page itself from scrolling.
  useBodyClass("is-tool-fixed", isToolPage && !tool.scrollable);
  useBodyClass("is-menu-visible", menuOpen);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Client-side navigation doesn't scroll by itself: jump to the #section if
  // there is one, otherwise to the top. `key` changes on every navigation, so
  // clicking "Home" while already home still scrolls up.
  useEffect(() => {
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash, key]);

  return (
    <>
      <div id="page-wrapper">
        {!isToolPage && <Header hasBanner={pathname === "/"} onMenuToggle={() => setMenuOpen((open) => !open)} />}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/blog" element={<BlogIndex />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/utils" element={<UtilsIndex />} />
          <Route path="/utils/:slug" element={<UtilPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        {!isToolPage && <Footer />}
      </div>

      {!isToolPage && <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />}
      {/* Always mounted: embed.js only builds the player once per page load. */}
      <JioSaavnWidget hidden={isToolPage} />
    </>
  );
}
