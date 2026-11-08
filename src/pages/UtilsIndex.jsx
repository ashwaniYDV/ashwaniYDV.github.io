import { Link } from "react-router";
import PageShell from "./PageShell.jsx";
import { utils } from "../utils/registry.js";
import { usePageTitle } from "../hooks.js";

export const UTILS_SUBTITLE = "Small tools that run in your browser. Your data never leaves this device";

export default function UtilsIndex() {
  usePageTitle("Utils | Ashwani Yadav");

  return (
    <PageShell title="Utils" subtitle={UTILS_SUBTITLE}>
      <section className="features utils-grid">
        {utils.map(({ slug, title, icon, summary }) => (
          <article key={slug} className="reveal">
            <Link to={`/utils/${slug}`} className="util-card-link">
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
    </PageShell>
  );
}
