import { menuLinks } from "../data.jsx";

// Matches the 350ms close transition from the Solid State theme.
const CLOSE_DELAY_MS = 350;

export default function Menu({ open, onClose }) {
  const go = (e, href) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
    window.setTimeout(() => {
      window.location.href = href;
    }, CLOSE_DELAY_MS);
  };

  return (
    <nav id="menu" aria-hidden={!open} onClick={onClose}>
      <div className="inner" onClick={(e) => e.stopPropagation()}>
        <h2>Menu</h2>
        <ul className="links">
          {menuLinks.map(({ label, href }) => (
            <li key={label}>
              <a href={href} tabIndex={open ? 0 : -1} onClick={(e) => go(e, href)}>
                {label}
              </a>
            </li>
          ))}
        </ul>
        <a
          href="#"
          className="close"
          tabIndex={open ? 0 : -1}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
        >
          Close
        </a>
      </div>
    </nav>
  );
}
