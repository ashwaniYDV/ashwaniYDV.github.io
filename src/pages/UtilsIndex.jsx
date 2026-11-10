import { Link } from "react-router";
import PageShell from "./PageShell.jsx";
import { sections } from "../utils/registry.js";
import { usePageTitle } from "../hooks.js";

/** Index page for one tool section (/utils, /pgutils, ...): a card per tool. */
export default function UtilsIndex({ section }) {
  usePageTitle(`${section.title} | Ashwani Yadav`);
  const others = sections.filter((s) => s.id !== section.id);

  return (
    <PageShell title={section.title} subtitle={section.subtitle}>
      <section className="features utils-grid">
        {section.tools.map(({ slug, title, icon, summary }) => (
          <article key={slug}>
            <Link to={`${section.path}/${slug}`} className="util-card-link">
              <span className="util-card-icon" aria-hidden="true">
                <i className={`fa ${icon}`}></i>
              </span>
              <h3 className="major">{title}</h3>
              <p>{summary}</p>
              <span className="special">Open</span>
            </Link>
          </article>
        ))}
      </section>
      {others.length > 0 && (
        <p className="utils-also">
          Also see:{" "}
          {others.map((s, i) => (
            <span key={s.id}>
              {i > 0 && " · "}
              <Link to={s.path}>
                <i className={`fa ${s.icon}`} aria-hidden="true"></i>&nbsp;{s.title}
              </Link>
            </span>
          ))}
        </p>
      )}
    </PageShell>
  );
}
