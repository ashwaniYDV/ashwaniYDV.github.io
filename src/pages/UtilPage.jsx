import { Component, Suspense } from "react";
import { Link, useParams } from "react-router";
import NotFound from "./NotFound.jsx";
import { getUtil } from "../utils/registry.js";
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

export default function UtilPage() {
  const { slug } = useParams();
  const util = getUtil(slug);
  usePageTitle(util ? `${util.title} | Utils | Ashwani Yadav` : "Not found | Ashwani Yadav");

  if (!util) return <NotFound />;
  const { Component: Tool } = util;

  return (
    <section id="wrapper" className="util-page">
      <header>
        <div className="inner">
          <h2>
            <i className={`fa ${util.icon}`} aria-hidden="true"></i>&nbsp;&nbsp;{util.title}
          </h2>
          <p>{util.summary}</p>
        </div>
      </header>
      <div className="wrapper">
        <div className="inner">
          <nav className="util-breadcrumb" aria-label="Breadcrumb">
            <Link to="/utils">
              <i className="fa fa-angle-left" aria-hidden="true"></i>&nbsp;All utils
            </Link>
          </nav>
          <UtilErrorBoundary key={slug}>
            <Suspense fallback={<p className="util-message">Loading {util.title}…</p>}>
              <Tool />
            </Suspense>
          </UtilErrorBoundary>
        </div>
      </div>
    </section>
  );
}
