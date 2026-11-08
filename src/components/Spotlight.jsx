import { img } from "../data.jsx";

/** One alternating "spotlight" row used for work and education entries. */
const DEFAULT_TITLE_STYLE = { textTransform: "none" };

export default function Spotlight({
  variant,
  title,
  url,
  image,
  imageStyle,
  flatImage,
  titleClassName = "major",
  titleStyle = DEFAULT_TITLE_STYLE,
  lines = [],
  description,
  links = [],
  linkClassName = "special",
  anchor,
}) {
  const imageClass = flatImage || imageStyle ? "image zeroradius" : "image";
  const external = url ? { href: url, target: "_blank", rel: "noreferrer" } : { href: "#" };

  return (
    <section className={`wrapper spotlight ${variant}`}>
      <div className="inner">
        <a {...external} className={imageClass}>
          <img src={img(image)} alt={title} className={flatImage ? "zeroradius" : undefined} style={imageStyle} />
        </a>
        <div className="content">
          <h2 className={titleClassName} style={titleStyle}>
            {title}
          </h2>
          {lines.map((line, i) => (
            <h3 key={i} className="nomargin myfont">
              {line}
            </h3>
          ))}
          {description && <p>{description}</p>}
          {links.map(({ label, url: href }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className={linkClassName}>
              {label}
            </a>
          ))}
        </div>
      </div>
      {anchor && <span id={anchor}></span>}
    </section>
  );
}
