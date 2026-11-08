import { projects } from "../data";

export default function Projects() {
  return (
    <section id="four" className="wrapper style1">
      <div className="inner">
        <h2 className="major">Highlights</h2>
        <p>
          This section contains some of the things I&apos;ve worked on before.
          <br />
          Many more such projects can be found at{" "}
          <a target="_blank" rel="noreferrer" href="https://github.com/ashwaniYDV">
            GitHub
          </a>
        </p>
        <section className="features">
          {projects.map(({ title, description, links }) => (
            <article key={title} className="reveal">
              <h3 className="major">{title}</h3>
              <p>{description}</p>
              {links.map(({ label, url }) => (
                <a key={label} target="_blank" rel="noreferrer" href={url} className="special">
                  {label}
                </a>
              ))}
            </article>
          ))}
        </section>
        <ul className="actions">
          <li>
            <a target="_blank" rel="noreferrer" href="https://github.com/ashwaniYDV" className="button">
              Browse All
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}
