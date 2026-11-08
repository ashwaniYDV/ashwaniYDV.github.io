import { useEffect, useRef, useState } from "react";

/** Header is transparent ("alt") while the banner is still under it, like scrollex did. */
export default function Header({ onMenuToggle }) {
  const ref = useRef(null);
  const [alt, setAlt] = useState(true);

  useEffect(() => {
    const update = () => {
      const banner = document.getElementById("banner");
      const header = ref.current;
      if (!banner || !header) return;
      setAlt(banner.getBoundingClientRect().bottom > header.offsetHeight);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <header id="header" ref={ref} className={alt ? "alt" : undefined}>
      <h1>
        <a href="./">Ashwani Yadav</a>
      </h1>
      <nav>
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
