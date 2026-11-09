import { useEffect } from "react";

export const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

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
