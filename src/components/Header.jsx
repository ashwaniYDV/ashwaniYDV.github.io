import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

/**
 * Header is transparent ("alt") while the home banner is still under it, like
 * scrollex did on v1. Pages without a banner get the solid header.
 */
export default function Header({ hasBanner, onMenuToggle }) {
  const ref = useRef(null);
  const [alt, setAlt] = useState(hasBanner);

  useEffect(() => {
    const update = () => {
      const banner = document.getElementById("banner");
      const header = ref.current;
      setAlt(Boolean(banner && header && banner.getBoundingClientRect().bottom > header.offsetHeight));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [hasBanner]);

  return (
    <header id="header" ref={ref} className={alt ? "alt" : undefined}>
      <h1>
        <Link to="/">Ashwani Yadav</Link>
      </h1>
      <nav>
        <Link className="button" to="/blog">
          <i className="fa fa-pencil" aria-hidden="true"></i>&nbsp;Blog
        </Link>
        <a className="button" href="https://www.linkedin.com/in/ashwaniydv/" target="_blank" rel="noreferrer">
          <i className="fa fa-linkedin" aria-hidden="true"></i>&nbsp;LinkedIn
        </a>
        <a
          className="button"
          href="#menu"
          aria-controls="menu"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMenuToggle();
          }}
        >
          &lt;nav&gt;
        </a>
      </nav>
    </header>
  );
}
