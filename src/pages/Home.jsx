import Banner from "../components/Banner.jsx";
import About from "../components/About.jsx";
import Spotlight from "../components/Spotlight.jsx";
import Projects from "../components/Projects.jsx";
import Etc from "../components/Etc.jsx";
import LatestPosts from "../components/LatestPosts.jsx";
import { education, work } from "../data";
import { usePageTitle } from "../hooks.js";

function SectionTitle({ children }) {
  return (
    <>
      <br />
      <h1 className="myfont section-title reveal">
        {children}
      </h1>
      <br />
    </>
  );
}

export default function Home() {
  usePageTitle("Ashwani Yadav");

  return (
    <>
      <Banner />

      <section id="wrapper">
        <About />

        <SectionTitle>Worked</SectionTitle>
        {work.map((item, i) => (
          <Spotlight key={item.title} {...item} anchor={i === work.length - 1 ? "alma-matter" : undefined} />
        ))}

        <SectionTitle>Alma mater</SectionTitle>
        {education.map((item, i) => (
          <Spotlight key={item.title} {...item} anchor={i === education.length - 1 ? "projects" : undefined} />
        ))}
        <br />

        <SectionTitle>Projects</SectionTitle>
        <Projects />
        <br />

        <SectionTitle>From the blog</SectionTitle>
        <LatestPosts />
        <br />

        <SectionTitle>Etc.</SectionTitle>
        <Etc />
      </section>
    </>
  );
}
