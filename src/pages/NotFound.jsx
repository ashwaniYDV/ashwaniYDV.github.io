import { Link } from "react-router";
import PageShell from "./PageShell.jsx";
import { usePageTitle } from "../hooks.js";

export default function NotFound() {
  usePageTitle("Not found | Ashwani Yadav");

  return (
    <PageShell title="Page not found" subtitle="That page doesn't exist, or it moved">
      <ul className="actions">
        <li>
          <Link to="/" className="button">
            Home
          </Link>
        </li>
        <li>
          <Link to="/blog" className="button">
            Blog
          </Link>
        </li>
      </ul>
    </PageShell>
  );
}
