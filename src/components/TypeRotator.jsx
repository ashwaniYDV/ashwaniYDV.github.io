import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../hooks.js";

const TYPE_MS = 70;
const DELETE_MS = 35;
const HOLD_MS = 1800;

/**
 * Types each phrase, holds it, deletes it, moves to the next. Screen readers
 * get the full list once instead of the character-by-character churn.
 * Reduced-motion users (and the pre-rendered HTML) see the first phrase.
 */
export default function TypeRotator({ phrases }) {
  const [text, setText] = useState(phrases[0] ?? "");
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (phrases.length < 2 || prefersReducedMotion()) return undefined;
    setAnimated(true);

    let index = 0;
    let length = phrases[0].length;
    let deleting = true;
    let timer = window.setTimeout(tick, HOLD_MS);

    // Starts showing phrase 0 in full; first step deletes it after a hold.
    function tick() {
      let delay;
      if (deleting) {
        length -= 1;
        if (length === 0) {
          deleting = false;
          index = (index + 1) % phrases.length;
        }
        delay = deleting ? DELETE_MS : TYPE_MS;
      } else {
        length += 1;
        const done = length === phrases[index].length;
        if (done) deleting = true;
        delay = done ? HOLD_MS : TYPE_MS;
      }
      setText(phrases[index].slice(0, length));
      timer = window.setTimeout(tick, delay);
    }

    return () => window.clearTimeout(timer);
  }, [phrases]);

  return (
    <span className="type-rotator">
      <span className="visually-hidden">{phrases.join(", ")}</span>
      <span aria-hidden="true">
        {text}
        <span className={animated ? "type-caret is-blinking" : "type-caret"}>|</span>
      </span>
    </span>
  );
}
