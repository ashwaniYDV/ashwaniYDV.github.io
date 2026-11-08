import PageShell from "./PageShell.jsx";
import { usePageTitle } from "../hooks.js";

export default function NotFound() {
  usePageTitle("Not found | Ashwani Yadav");

  return (
    <PageShell title="Page not found" subtitle="That page doesn't exist, or it moved">
      <ul className="actions">
        <li>
          <a href="/" className="button">
            Home
          </a>
        </li>
        <li>
          <a href="/blog" className="button">
            Blog
          </a>
        </li>
      </ul>
    </PageShell>
  );
}
