import { useEffect, useRef } from "react";
import VanillaTilt from "vanilla-tilt";

export const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Fade/slide `.reveal` elements in as they scroll into view. The hiding CSS
 * only applies under `html.js-reveal`, which this hook sets, so pre-rendered
 * pages stay fully visible without JavaScript or with reduced motion.
 */
export function useRevealOnScroll(routeKey) {
  useEffect(() => {
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) return undefined;
    document.documentElement.classList.add("js-reveal");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [routeKey]);
}

/** Toggle a class on <body> while `active` is true. */
export function useBodyClass(className, active) {
  useEffect(() => {
    document.body.classList.toggle(className, active);
    return () => document.body.classList.remove(className);
  }, [className, active]);
}

/** Keep document.title in sync during client-side navigation. */
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** Same settings the original page passed to tilt.jquery. */
export function useTilt() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return undefined;
    VanillaTilt.init(el, { max: 20, speed: 300, glare: true, "max-glare": 0.5 });
    return () => el.vanillaTilt?.destroy();
  }, []);
  return ref;
}

/**
 * Port of assets/js/pointer_sparkle2.js: coloured sparkles that fall from the
 * mouse pointer. Skipped for users who prefer reduced motion.
 */
export function usePointerSparkles(count = 100) {
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;

    const makeDiv = (size) => {
      const d = document.createElement("div");
      Object.assign(d.style, {
        position: "absolute",
        width: `${size}px`,
        height: `${size}px`,
        overflow: "hidden",
        visibility: "hidden",
        zIndex: "999",
        pointerEvents: "none",
      });
      return d;
    };

    const newColor = () => {
      const c = [255, Math.floor(Math.random() * 256)];
      c.push(Math.floor(Math.random() * (256 - c[1] / 2)));
      c.sort(() => 0.5 - Math.random());
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    };

    const stars = [];
    const tinies = [];
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    for (let i = 0; i < count; i++) {
      const tiny = makeDiv(3);
      const star = makeDiv(5);
      star.style.backgroundColor = "transparent";
      for (let k = 0; k < 2; k++) {
        const dot = makeDiv(5);
        dot.style.visibility = "inherit";
        dot.style.position = "static";
        dot.style.borderRadius = "50%";
        star.appendChild(dot);
      }
      container.append(tiny, star);
      tinies.push({ el: tiny, life: 0, x: 0, y: 0 });
      stars.push({ el: star, life: 0, x: 0, y: 0 });
    }
    document.body.appendChild(container);

    let x = 300, y = 300, ox = 300, oy = 300;
    const onMove = (e) => {
      x = e.pageX;
      y = e.pageY;
    };
    document.addEventListener("mousemove", onMove);

    const bottom = () => window.innerHeight + window.scrollY;

    const tick = () => {
      if (Math.abs(x - ox) > 1 || Math.abs(y - oy) > 1) {
        ox = x;
        oy = y;
        const s = stars.find((st) => !st.life);
        if (s) {
          s.x = x;
          s.y = y + 1;
          s.life = 50;
          const color = newColor();
          [...s.el.childNodes].forEach((n) => (n.style.backgroundColor = color));
          Object.assign(s.el.style, {
            left: `${s.x}px`,
            top: `${s.y}px`,
            clip: "rect(0px, 5px, 5px, 0px)",
            visibility: "visible",
          });
        }
      }

      stars.forEach((s, i) => {
        if (s.life) {
          if (--s.life === 25) s.el.style.clip = "rect(1px, 4px, 4px, 1px)";
          if (s.life) {
            s.y += 1 + Math.random() * 3;
            s.x += ((i % 5) - 2) / 5;
            if (s.y < bottom()) {
              s.el.style.top = `${s.y}px`;
              s.el.style.left = `${s.x}px`;
            } else {
              s.el.style.visibility = "hidden";
              s.life = 0;
            }
          } else {
            // Star burned out: hand off to a smaller "tiny" particle.
            const t = tinies[i];
            t.life = 50;
            t.x = s.x;
            t.y = s.y;
            Object.assign(t.el.style, {
              top: `${t.y}px`,
              left: `${t.x}px`,
              width: "2px",
              height: "2px",
              backgroundColor: s.el.childNodes[0].style.backgroundColor,
              visibility: "visible",
            });
            s.el.style.visibility = "hidden";
          }
        }

        const t = tinies[i];
        if (t.life) {
          if (--t.life === 25) {
            t.el.style.width = "1px";
            t.el.style.height = "1px";
          }
          if (t.life) {
            t.y += 1 + Math.random() * 3;
            t.x += ((i % 5) - 2) / 5;
            if (t.y < bottom()) {
              t.el.style.top = `${t.y}px`;
              t.el.style.left = `${t.x}px`;
            } else {
              t.el.style.visibility = "hidden";
              t.life = 0;
            }
          } else {
            t.el.style.visibility = "hidden";
          }
        }
      });
    };

    const timer = window.setInterval(tick, 40);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("mousemove", onMove);
      container.remove();
    };
  }, [count]);
}
