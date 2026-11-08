import { useEffect } from "react";

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
