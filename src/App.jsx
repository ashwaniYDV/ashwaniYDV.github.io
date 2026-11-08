import { useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router";
import Header from "./components/Header.jsx";
import Menu from "./components/Menu.jsx";
import Footer from "./components/Footer.jsx";
import JioSaavnWidget from "./components/JioSaavnWidget.jsx";
import ScrollChrome from "./components/ScrollChrome.jsx";
import Home from "./pages/Home.jsx";
import BlogIndex from "./pages/BlogIndex.jsx";
import BlogPost from "./pages/BlogPost.jsx";
import NotFound from "./pages/NotFound.jsx";
import { useBodyClass, usePointerSparkles, useRevealOnScroll } from "./hooks.js";

export default function App() {
  const { pathname, hash, key } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useBodyClass("is-menu-visible", menuOpen);
  usePointerSparkles();
  useRevealOnScroll(pathname);

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
        <Header hasBanner={pathname === "/"} onMenuToggle={() => setMenuOpen((open) => !open)} />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/blog" element={<BlogIndex />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
      </div>

      <ScrollChrome />
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />
      <JioSaavnWidget />
    </>
  );
}
