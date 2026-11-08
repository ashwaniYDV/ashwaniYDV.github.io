/** Solid State "generic page" layout: a header band, then one content wrapper. */
export default function PageShell({ title, subtitle, children }) {
  return (
    <section id="wrapper">
      <header>
        <div className="inner">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </header>
      <div className="wrapper">
        <div className="inner">{children}</div>
      </div>
    </section>
  );
}
