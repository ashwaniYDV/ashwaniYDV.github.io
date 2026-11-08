import { RESUME_URL, socials } from "../data.jsx";
import { useTilt } from "../hooks.js";

export default function Banner() {
  const avatarRef = useTilt();

  return (
    <section id="banner">
      <div className="inner">
        <div className="logo" style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          {/* Avatar is drawn via the #homeimg background in home.css. */}
          <div
            id="homeimg"
            ref={avatarRef}
            role="img"
            aria-label="Ashwani Yadav"
            style={{ position: "relative" }}
          />
        </div>

        <h2 id="headtext" className="notr myfont" style={{ textAlign: "center" }}>
          <b>Ashwani Yadav</b>
        </h2>

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
      </div>
    </section>
  );
}
