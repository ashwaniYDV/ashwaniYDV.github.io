import { img } from "../data";
import RichText from "./RichText.jsx";

// JSON `variant` values mapped to the Solid State wrapper classes.
const VARIANT_CLASSES = { light: "style1", dark: "style2 alt" };
const DEFAULT_TITLE_STYLE = { textTransform: "none" };

/** One alternating "spotlight" row used for work and education entries. */
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
  current = false,
  anchor,
}) {
  const imageClass = flatImage || imageStyle ? "image zeroradius" : "image";
  const external = url ? { href: url, target: "_blank", rel: "noreferrer" } : { href: "#" };

  return (
    <section className={`wrapper spotlight ${VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.light}`}>
      <div className="inner">
        <a {...external} className={imageClass}>
          <img src={img(image)} alt={title} className={flatImage ? "zeroradius" : undefined} style={imageStyle} />
        </a>
        <div className="content">
          <h2 className={titleClassName} style={titleStyle}>
            {title}
            {current && (
              <span className="now-badge">
                <span className="now-dot" aria-hidden="true" />
                Now
              </span>
            )}
          </h2>
          {lines.map((line, i) => (
            <h3 key={i} className="nomargin myfont">
              <RichText text={line} />
            </h3>
          ))}
          {description && (
            <p>
              <RichText text={description} />
            </p>
          )}
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
