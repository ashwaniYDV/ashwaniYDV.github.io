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
import { useBodyClass, usePointerSparkles } from "./hooks.js";

export default function App() {
  const { pathname, hash } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useBodyClass("is-menu-visible", menuOpen);
  usePointerSparkles();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Client-side navigation keeps the old scroll position; start new pages at the top.
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

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

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />
      <JioSaavnWidget />
    </>
  );
}
