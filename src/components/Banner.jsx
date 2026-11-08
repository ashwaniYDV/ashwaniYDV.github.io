import { RESUME_URL, socials, taglines } from "../data";
import { useTilt } from "../hooks.js";
import TypeRotator from "./TypeRotator.jsx";

export default function Banner() {
  const avatarRef = useTilt();

  return (
    <section id="banner">
      <div className="inner">
        <div className="logo" style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          {/* Slowly rotating gradient ring; the avatar itself is the #homeimg background in home.css. */}
          <div className="avatar-ring">
            <div
              id="homeimg"
              ref={avatarRef}
              role="img"
              aria-label="Ashwani Yadav"
              style={{ position: "relative" }}
            />
          </div>
        </div>

        <h2 id="headtext" className="notr myfont" style={{ textAlign: "center" }}>
          <b>Ashwani Yadav</b>
        </h2>

        {taglines.length > 0 && (
          <p className="notr myfont hero-tagline">
            <TypeRotator phrases={taglines} />
          </p>
        )}

        <p className="notr myfont" style={{ textAlign: "center" }}>
          <span lang="sa">यतो धर्मस्ततो जयः</span>
          <br />
          {socials.map(({ name, icon, url }) => (
            <a key={name} target="_blank" rel="noreferrer" href={url} className={`fa faw-up ${icon}`} aria-label={name}></a>
          ))}
          <br />
          <a href={RESUME_URL} target="_blank" rel="noreferrer" className="button">
            Resume
          </a>
          <span id="intro"></span>
        </p>

        <a href="#one" className="scroll-cue" aria-label="Scroll to About me">
          <i className="fa fa-angle-down" aria-hidden="true"></i>
        </a>
      </div>

    </section>
  );
}
