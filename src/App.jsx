import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import Menu from "./components/Menu.jsx";
import Banner from "./components/Banner.jsx";
import About from "./components/About.jsx";
import Spotlight from "./components/Spotlight.jsx";
import Projects from "./components/Projects.jsx";
import Etc from "./components/Etc.jsx";
import Footer from "./components/Footer.jsx";
import JioSaavnWidget from "./components/JioSaavnWidget.jsx";
import { education, work } from "./data.jsx";
import { useBodyClass, usePointerSparkles } from "./hooks.js";

function SectionTitle({ children }) {
  return (
    <>
      <br />
      <h1 style={{ fontSize: "3em", textAlign: "center" }} className="myfont">
        {children}
      </h1>
      <br />
    </>
  );
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  useBodyClass("is-menu-visible", menuOpen);
  usePointerSparkles();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div id="page-wrapper">
        <Header onMenuToggle={() => setMenuOpen((open) => !open)} />
        <Banner />

        <section id="wrapper">
          <About />

          <SectionTitle>Worked</SectionTitle>
          {work.map((item, i) => (
            <Spotlight
              key={item.title}
              {...item}
              anchor={i === work.length - 1 ? "alma-matter" : undefined}
            />
          ))}

          <SectionTitle>Alma mater</SectionTitle>
          {education.map((item, i) => (
            <Spotlight
              key={item.title}
              {...item}
              anchor={i === education.length - 1 ? "projects" : undefined}
            />
          ))}
          <br />

          <SectionTitle>Projects</SectionTitle>
          <Projects />
          <br />

          <SectionTitle>Etc.</SectionTitle>
          <Etc />
        </section>

        <Footer />
      </div>

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />
      <JioSaavnWidget />
    </>
  );
}
