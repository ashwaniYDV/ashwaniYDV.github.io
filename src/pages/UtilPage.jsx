import { Component, Suspense } from "react";
import { Link, useParams } from "react-router";
import NotFound from "./NotFound.jsx";
import { getTool } from "../utils/registry.js";
import { usePageTitle } from "../hooks.js";

/** Keeps a crashing utility (or a failed chunk download) from taking down the site. */
class UtilErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="util-message">
          <p>This tool failed to load. Check your connection and try again.</p>
          <button type="button" className="button small" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** "‹ Section / Tool name": rendered by each tool at the start of its own toolbar. */
function ToolHeading({ section, util }) {
  return (
    <div className="tool-heading">
      <Link to={section.path} className="tool-back">
        <i className="fa fa-angle-left" aria-hidden="true"></i>&nbsp;{section.title}
      </Link>
      <h1 className="tool-title">
        <i className={`fa ${util.icon}`} aria-hidden="true"></i>&nbsp;{util.title}
      </h1>
    </div>
  );
}

/**
 * Full-screen tool layout: the tool fills the whole viewport. App hides the
 * site navbar, menu, footer and floating widgets on these pages.
 */
export default function UtilPage({ section }) {
  const { slug } = useParams();
  const util = getTool(section, slug);
  usePageTitle(util ? `${util.title} | ${section.title} | Ashwani Yadav` : "Not found | Ashwani Yadav");

  if (!util) return <NotFound />;
  const { Component: Tool } = util;
  const heading = <ToolHeading section={section} util={util} />;

  return (
    <main className={util.scrollable ? "tool-page is-scrollable" : "tool-page"}>
      <UtilErrorBoundary key={slug}>
        <Suspense
          fallback={
            <div className="util-toolbar">
              {heading}
              <span className="util-message">Loading…</span>
            </div>
          }
        >
          <Tool heading={heading} />
        </Suspense>
      </UtilErrorBoundary>
    </main>
  );
}
