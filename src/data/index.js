// Site content lives in the JSON files next to this module; edit those, not this file.
import site from "./site.json";
import socials from "./socials.json";
import work from "./work.json";
import education from "./education.json";
import projects from "./projects.json";

const images = import.meta.glob("../assets/images/*", {
  eager: true,
  import: "default",
});

/** Resolve a file in src/assets/images to its bundled URL. */
export const img = (name) => images[`../assets/images/${name}`];

export const RESUME_URL = site.resumeUrl;
export const FORMSPREE_URL = site.formspreeUrl;
export const menuLinks = site.menuLinks;
export { socials, work, education, projects };
